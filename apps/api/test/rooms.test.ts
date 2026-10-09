import { env } from "cloudflare:workers";
import { PIN_CREATE_ATTEMPTS, PIN_LOOKUP_LIMIT, WS_CONNECT_LIMIT } from "@sorak/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORIGIN, request, signedInHost } from "./http.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Kendali GameRoom fake (lihat vitest.config.ts). Body selalu dibaca supaya objeknya bisa idle. */
async function control(pin: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await env.GAME_ROOM.getByName(`room:${pin}`).fetch(`https://room${path}`, init);
  const text = await res.text();
  return text === "" ? null : JSON.parse(text);
}

const occupy = (pin: string) => control(pin, "/init", { method: "POST", body: "{}" });
const setJoinInfo = (pin: string, status: string, playerCount = 0) =>
  control(pin, "/fake/join-info", { method: "PUT", body: JSON.stringify({ status, playerCount }) });

/** PIN yang akan dihasilkan newPin berikutnya, berurutan. */
function nextPins(...pins: string[]) {
  const values = pins.map(Number);
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (array instanceof Uint32Array) {
      const value = values.shift();
      if (value === undefined) throw new Error("PIN uji habis");
      array[0] = value;
    }
    return array;
  });
}

const question = { prompt: "Ibu kota Indonesia?", options: ["Jakarta", "Bandung"], correctIndex: 0, timeLimitSec: 20, explanation: "Sejak 1945." };

async function hostWithQuiz(questions: unknown[] = [question]) {
  const host = await signedInHost();
  const res = await host.send("/api/quizzes", { method: "POST", json: { title: "Kuis Demo", description: null, questions } });
  const quiz = (await res.json()) as { id: string; questions: { id: string }[] };
  return { host, quiz };
}

describe("POST /api/rooms", () => {
  it("membuat room dan mengirim mode skor serta snapshot kuis ke GameRoom", async () => {
    const { host, quiz } = await hostWithQuiz();
    nextPins("314159");
    const res = await host.send("/api/rooms", { method: "POST", json: { quizId: quiz.id, scoringMode: "accurate" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pin: "314159" });

    expect(await control("314159", "/fake/init")).toEqual({
      gameId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      hostId: host.id,
      pin: "314159",
      scoringMode: "accurate",
      teamMode: false,
      quiz: {
        quizId: quiz.id,
        title: "Kuis Demo",
        questions: [
          {
            questionId: quiz.questions[0]?.id,
            prompt: question.prompt,
            options: question.options,
            correctIndex: 0,
            timeLimitSec: 20,
            imageUrl: null,
          },
        ],
      },
    });
  });

  it("kuis milik host lain -> 404", async () => {
    const { quiz } = await hostWithQuiz();
    const other = await signedInHost();
    const res = await other.send("/api/rooms", { method: "POST", json: { quizId: quiz.id, scoringMode: "classic" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("kuis tanpa soal -> 409", async () => {
    const { host, quiz } = await hostWithQuiz([]);
    const res = await host.send("/api/rooms", { method: "POST", json: { quizId: quiz.id, scoringMode: "classic" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "CONFLICT", message: "Tambahkan minimal satu soal" } });
  });

  it("quizId bukan UUID -> 400", async () => {
    const host = await signedInHost();
    const res = await host.send("/api/rooms", { method: "POST", json: { quizId: "kuis-1", scoringMode: "classic" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", fields: { quizId: expect.any(String) } } });
  });

  it("mode confidence belum tersedia -> 400", async () => {
    const { host, quiz } = await hostWithQuiz();
    const res = await host.send("/api/rooms", { method: "POST", json: { quizId: quiz.id, scoringMode: "confidence" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED", fields: { scoringMode: expect.any(String) } } });
  });

  it("tanpa login -> 401", async () => {
    const res = await request("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ quizId: crypto.randomUUID(), scoringMode: "classic" }),
    });
    expect(res.status).toBe(401);
  });

  it("PIN pertama bentrok -> percobaan kedua berhasil", async () => {
    const { host, quiz } = await hostWithQuiz();
    await occupy("271828");
    nextPins("271828", "271829");
    const res = await host.send("/api/rooms", { method: "POST", json: { quizId: quiz.id, scoringMode: "classic" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ pin: "271829" });
  });

  it(`semua ${PIN_CREATE_ATTEMPTS} percobaan bentrok -> 500`, async () => {
    const { host, quiz } = await hostWithQuiz();
    const pins = Array.from({ length: PIN_CREATE_ATTEMPTS }, (_, i) => String(161_800 + i));
    for (const pin of pins) await occupy(pin);
    nextPins(...pins);
    const res = await host.send("/api/rooms", { method: "POST", json: { quizId: quiz.id, scoringMode: "classic" } });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "INTERNAL" } });
  });
});

describe("GET /api/rooms/:pin", () => {
  const lookup = (pin: string, ip = "198.51.100.1") => request(`/api/rooms/${pin}`, { headers: { "CF-Connecting-IP": ip } });

  it("room terbuka -> 200 dengan jumlah pemain", async () => {
    await occupy("100001");
    await setJoinInfo("100001", "open", 7);
    const res = await lookup("100001");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pin: "100001", playerCount: 7 });
  });

  it.each([
    ["not_found", 404, "NOT_FOUND"],
    ["started", 409, "GAME_ALREADY_STARTED"],
    ["full", 409, "ROOM_FULL"],
  ])("status %s -> %i %s", async (status, httpStatus, code) => {
    const pin = String(100_100 + httpStatus + status.length);
    await setJoinInfo(pin, status);
    const res = await lookup(pin);
    expect(res.status).toBe(httpStatus);
    expect(await res.json()).toMatchObject({ error: { code } });
  });

  it("PIN abc -> 404", async () => {
    const res = await lookup("abc");
    expect(res.status).toBe(404);
  });

  // Binding asli menghitung per jendela 60 detik; saat semua paket dites paralel, 120 request bisa melewati
  // batas jendela dan hitungannya mulai dari nol (test tidak stabil). Yang diuji di sini pemetaan "batas habis"
  // ke 429 dan kunci per IP, bukan ketepatan hitungan Cloudflare, jadi binding diganti fake yang selalu habis.
  it("batas tebakan PIN habis -> 429 RATE_LIMITED, dengan IP sebagai kunci", async () => {
    const limit = vi.spyOn(env.PIN_LOOKUP, "limit").mockResolvedValue({ success: false });
    const res = await lookup("100200", "203.0.113.121");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.121" });
  });

  it("PIN_LOOKUP_LIMIT sama dengan binding ratelimits di wrangler.jsonc", () => {
    expect(env.TEST_PIN_LOOKUP_RATELIMIT).toMatchObject({
      simple: { limit: PIN_LOOKUP_LIMIT.limit, period: PIN_LOOKUP_LIMIT.periodSec },
    });
  });
});

describe("batas WebSocket pemain (WS_CONNECT)", () => {
  const upgrade = (pin: string, ip: string) =>
    request(`/ws/play/${pin}`, { headers: { Upgrade: "websocket", "CF-Connecting-IP": ip } });

  it("memakai WS_CONNECT, bukan PIN_LOOKUP; batas habis -> 429 dengan IP sebagai kunci", async () => {
    const pinLookup = vi.spyOn(env.PIN_LOOKUP, "limit");
    const wsConnect = vi.spyOn(env.WS_CONNECT, "limit").mockResolvedValue({ success: false });
    const res = await upgrade("100201", "203.0.113.130");
    expect(res.status).toBe(429);
    expect(wsConnect).toHaveBeenCalledWith({ key: "203.0.113.130" });
    expect(pinLookup).not.toHaveBeenCalled();
  });

  it("200 upgrade dari satu IP dalam beberapa detik (reconnect massal satu aula) tidak ada yang kena 429", async () => {
    const ip = "203.0.113.200";
    const statuses = await Promise.all(Array.from({ length: 200 }, async (_, i) => (await upgrade(String(100_400 + i), ip)).status));
    expect(statuses.filter((status) => status === 429)).toHaveLength(0);
    // Batas cek PIN untuk IP yang sama tidak ikut terpakai oleh reconnect.
    const lookup = await request("/api/rooms/100400", { headers: { "CF-Connecting-IP": ip } });
    expect(lookup.status).not.toBe(429);
  });

  it("WS_CONNECT_LIMIT sama dengan binding ratelimits di wrangler.jsonc", () => {
    expect(env.TEST_WS_CONNECT_RATELIMIT).toMatchObject({
      simple: { limit: WS_CONNECT_LIMIT.limit, period: WS_CONNECT_LIMIT.periodSec },
    });
  });
});

type Forwarded = { url: string; headers: Record<string, string> };

describe("WebSocket ke GameRoom", () => {
  const upgrade = { Upgrade: "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" };

  it("jalur play: GameRoom menerima route play tanpa X-Sorak-Host-Id", async () => {
    const res = await request("/ws/play/100301?target=/init", {
      headers: { ...upgrade, "X-Sorak-Host-Id": "guru-palsu", "X-Sorak-Route": "host", Cookie: "sorak_session=abc" },
    });
    const forwarded = (await res.json()) as Forwarded;
    expect(forwarded.url).toBe("https://room/connect");
    expect(forwarded.headers).toMatchObject({ "x-sorak-route": "play", upgrade: "websocket", "sec-websocket-version": "13" });
    expect(forwarded.headers).not.toHaveProperty("x-sorak-host-id");
    expect(forwarded.headers).not.toHaveProperty("cookie");
  });

  it("jalur play tanpa upgrade -> 426", async () => {
    expect((await request("/ws/play/100302")).status).toBe(426);
  });

  it("jalur host: GameRoom menerima id host dari sesi, bukan dari header klien", async () => {
    const host = await signedInHost();
    const res = await host.send("/ws/host/100303", { headers: { ...upgrade, "X-Sorak-Host-Id": "guru-palsu" } });
    const forwarded = (await res.json()) as Forwarded;
    expect(forwarded.headers).toMatchObject({ "x-sorak-route": "host", "x-sorak-host-id": host.id });
    expect(forwarded.headers).not.toHaveProperty("cookie");
  });

  it("jalur host tanpa cookie -> 401", async () => {
    const res = await request("/ws/host/100304", { headers: { ...upgrade, Origin: ORIGIN } });
    expect(res.status).toBe(401);
  });

  it("jalur host dari Origin asing -> 403", async () => {
    const host = await signedInHost();
    const res = await host.send("/ws/host/100305", { headers: { ...upgrade, Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});
