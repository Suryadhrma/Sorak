import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_DAILY_LIMIT_PER_HOST, AI_PROMPT_VERSION, AI_QUESTION_COUNTS, AiDraftResponse, ApiError } from "@sorak/shared";
import { QUOTA_SQL, wibDayStart } from "../src/ai/quota.ts";
import { request, signedInHost } from "./http.ts";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const sourceText = [
  "Sel adalah unit terkecil penyusun makhluk hidup.",
  "Membran sel mengatur zat yang keluar dan masuk ke dalam sel.",
  "Mitokondria menghasilkan energi melalui respirasi sel.",
  "Ribosom adalah tempat sintesis protein.",
  "Inti sel menyimpan materi genetik berupa DNA.",
].join(" ");

const draft = (i: number, evidence = "Ribosom adalah tempat sintesis protein.") => ({
  prompt: `Soal nomor ${i + 1} tentang sel?`,
  options: ["Mitokondria", "Ribosom", "Membran sel", "Inti sel"],
  correctIndex: 1,
  explanation: "Materi menyebut ribosom sebagai tempat sintesis protein.",
  evidence,
});

/** Lima soal, yang terakhir buktinya karangan (tidak ada di materi). */
const fiveDrafts = () => [...Array.from({ length: 4 }, (_, i) => draft(i)), draft(4, "Ribosom menghasilkan energi untuk sel.")];

/** Bentuk respons chat completions Groq; hanya field yang dibaca server. */
function groqCompletion(content: string, usage = { prompt_tokens: 1200, completion_tokens: 900 }) {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "openai/gpt-oss-120b",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  });
}

/** Groq selalu di-mock lewat globalThis.fetch; test tidak pernah memanggil Groq sungguhan. */
function mockGroq(response: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
}

type Host = Awaited<ReturnType<typeof signedInHost>>;

const generate = (host: Host, body: unknown = { sourceText, count: 5 }, bindings?: Env) =>
  host.send("/api/ai/generate", { method: "POST", json: body, bindings });

type GenerationRow = {
  status: string;
  model: string;
  input_type: string;
  questions_count: number;
  grounded_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  prompt_version: string | null;
};

async function generations(hostId: string) {
  const { results } = await env.DB.prepare(
    `SELECT status, model, input_type, questions_count, grounded_count, input_tokens, output_tokens, latency_ms, prompt_version
     FROM ai_generations WHERE host_id = ? ORDER BY created_at`,
  )
    .bind(hostId)
    .all<GenerationRow>();
  return results;
}

/** Baris ai_generations buatan test, untuk mengisi kuota tanpa memanggil endpoint berkali-kali. */
async function fillQuota(hostId: string, createdAt: number, count = AI_DAILY_LIMIT_PER_HOST) {
  const insert = env.DB.prepare(
    "INSERT INTO ai_generations (id, host_id, input_type, model, status, created_at) VALUES (?, ?, 'text', 'test-model', 'ok', ?)",
  );
  await env.DB.batch(Array.from({ length: count }, () => insert.bind(crypto.randomUUID(), hostId, createdAt)));
}

async function errorOf(res: Response) {
  return ApiError.parse(await res.json()).error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("akses dan validasi", () => {
  it("tanpa login: 401, Groq tidak dipanggil", async () => {
    const fetchSpy = mockGroq(() => groqCompletion("{}"));
    const res = await request("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://sorak.test" },
      body: JSON.stringify({ sourceText, count: 5 }),
    });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("materi terlalu pendek atau jumlah soal tidak didukung: 400 VALIDATION_FAILED dengan fields", async () => {
    const host = await signedInHost();
    const fetchSpy = mockGroq(() => groqCompletion("{}"));

    const short = await generate(host, { sourceText: "terlalu pendek", count: 5 });
    expect(short.status).toBe(400);
    expect(await errorOf(short)).toMatchObject({ code: "VALIDATION_FAILED", fields: { sourceText: expect.any(String) } });

    const count = await generate(host, { sourceText, count: 7 });
    expect(count.status).toBe(400);
    expect((await errorOf(count)).fields).toHaveProperty("count");

    const broken = await host.send("/api/ai/generate", { method: "POST", body: "{bukan json" });
    expect(broken.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await generations(host.id)).toEqual([]);
  });

  it("tanpa GROQ_API_KEY: 503 AI_UNAVAILABLE, Groq tidak dipanggil, tidak ada baris", async () => {
    const host = await signedInHost();
    const fetchSpy = mockGroq(() => groqCompletion("{}"));
    const res = await generate(host, undefined, Object.assign({}, env, { GROQ_API_KEY: "" }));
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toEqual({
      code: "AI_UNAVAILABLE",
      message: "Fitur AI sedang tidak tersedia. Kamu tetap bisa membuat soal manual.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await generations(host.id)).toEqual([]);
  });
});

describe("panggilan Groq", () => {
  it("sukses: 200 AiDraftResponse dengan grounded, baris ok mencatat token, grounded, dan versi prompt", async () => {
    const host = await signedInHost();
    const fetchSpy = mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));

    const res = await generate(host);
    expect(res.status).toBe(200);
    const body = AiDraftResponse.parse(await res.json());
    expect(body.drafts.map((d) => d.grounded)).toEqual([true, true, true, true, false]);
    expect(body).toMatchObject({ model: env.GROQ_TEXT_MODEL, promptVersion: AI_PROMPT_VERSION });

    expect(await generations(host.id)).toEqual([
      {
        status: "ok",
        model: env.GROQ_TEXT_MODEL,
        input_type: "text",
        questions_count: 5,
        grounded_count: 4,
        input_tokens: 1200,
        output_tokens: 900,
        latency_ms: expect.any(Number),
        prompt_version: AI_PROMPT_VERSION,
      },
    ]);

    // Permintaan ke Groq: model dari vars, schema strict, temperature 0.4, batas waktu, dan materi di dalam penanda.
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(GROQ_URL);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${env.GROQ_API_KEY}`);
    const sent: unknown = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({
      model: env.GROQ_TEXT_MODEL,
      temperature: 0.4,
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(JSON.stringify(sent)).toContain(`<materi>\\n${sourceText}\\n</materi>`);
  });

  it.each(AI_QUESTION_COUNTS)("jumlah soal %i diteruskan ke prompt", async (count) => {
    const host = await signedInHost();
    const questions = Array.from({ length: count }, (_, i) => draft(i));
    const fetchSpy = mockGroq(() => groqCompletion(JSON.stringify({ questions })));
    const res = await generate(host, { sourceText, count });
    expect(res.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0]?.[1]?.body)).toContain(`${count} soal`);
  });

  it("isi materi dan isi soal tidak disimpan di D1", async () => {
    const host = await signedInHost();
    mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));
    await generate(host);
    const row = await env.DB.prepare("SELECT * FROM ai_generations WHERE host_id = ?").bind(host.id).first();
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("Ribosom");
    expect(stored).not.toContain("Soal nomor");
  });

  it("draf tidak masuk ke kuis mana pun", async () => {
    const host = await signedInHost();
    mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions").first<{ n: number }>();
    await generate(host);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM questions").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("output tidak lolos validasi (3 pilihan): 502 AI_INVALID_OUTPUT, baris invalid_schema dengan token", async () => {
    const host = await signedInHost();
    const questions = fiveDrafts().map((q, i) => (i === 2 ? { ...q, options: ["A", "B", "C"] } : q));
    mockGroq(() => groqCompletion(JSON.stringify({ questions })));

    const res = await generate(host);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toEqual({ code: "AI_INVALID_OUTPUT", message: "AI mengembalikan soal yang tidak valid. Coba lagi." });
    expect(await generations(host.id)).toMatchObject([
      { status: "invalid_schema", questions_count: 0, grounded_count: null, input_tokens: 1200, output_tokens: 900 },
    ]);
  });

  it("JSON rusak di content: 502 AI_INVALID_OUTPUT", async () => {
    const host = await signedInHost();
    mockGroq(() => groqCompletion('{"questions": ['));
    expect((await generate(host)).status).toBe(502);
    expect(await generations(host.id)).toMatchObject([{ status: "invalid_schema" }]);
  });

  it("Groq 429: 429 AI_RATE_LIMITED dengan retryAfterSec dari header retry-after, baris provider_error", async () => {
    const host = await signedInHost();
    mockGroq(() => Response.json({ error: { message: "Rate limit reached" } }, { status: 429, headers: { "retry-after": "12" } }));

    const res = await generate(host);
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toMatchObject({ code: "AI_RATE_LIMITED", retryAfterSec: 12 });
    expect(await generations(host.id)).toMatchObject([{ status: "provider_error", input_tokens: null, output_tokens: null }]);
  });

  it("Groq 429 tanpa retry-after yang terbaca: retryAfterSec 30", async () => {
    const host = await signedInHost();
    mockGroq(() => new Response("sibuk", { status: 429, headers: { "retry-after": "besok" } }));
    expect((await errorOf(await generate(host))).retryAfterSec).toBe(30);
  });

  it.each([
    ["Groq 500", () => new Response("upstream error", { status: 500 })],
    ["Groq 401 (key salah)", () => Response.json({ error: { message: "Invalid API Key" } }, { status: 401 })],
    ["200 tapi bentuk respons bukan chat completion", () => Response.json({ hasil: "aneh" })],
  ])("%s: 503 AI_UNAVAILABLE, baris provider_error", async (_, response) => {
    const host = await signedInHost();
    mockGroq(response);
    const res = await generate(host);
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("AI_UNAVAILABLE");
    expect(await generations(host.id)).toMatchObject([{ status: "provider_error" }]);
  });

  it("timeout (AbortSignal.timeout) dan error jaringan: 503 AI_UNAVAILABLE, baris provider_error", async () => {
    const host = await signedInHost();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    expect((await generate(host)).status).toBe(503);

    fetchSpy.mockRejectedValueOnce(new TypeError("Network connection lost."));
    expect((await generate(host)).status).toBe(503);
    expect(await generations(host.id)).toMatchObject([{ status: "provider_error" }, { status: "provider_error" }]);
  });
});

describe("kuota harian per guru", () => {
  it(`setelah ${AI_DAILY_LIMIT_PER_HOST} permintaan hari ini: 429 AI_QUOTA_EXCEEDED tanpa memanggil Groq, dan ditolak pun dicatat`, async () => {
    const host = await signedInHost();
    await fillQuota(host.id, Date.now());
    const fetchSpy = mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));

    const res = await generate(host);
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toEqual({ code: "AI_QUOTA_EXCEEDED", message: "Jatah AI hari ini habis. Coba lagi besok." });
    expect(fetchSpy).not.toHaveBeenCalled();
    const rows = await generations(host.id);
    expect(rows).toHaveLength(AI_DAILY_LIMIT_PER_HOST + 1);
    expect(rows.filter((row) => row.status === "quota_exceeded")).toHaveLength(1);
  });

  it("satu di bawah batas masih boleh", async () => {
    const host = await signedInHost();
    await fillQuota(host.id, Date.now(), AI_DAILY_LIMIT_PER_HOST - 1);
    mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));
    expect((await generate(host)).status).toBe(200);
  });

  it("kuota satu guru tidak bocor ke guru lain", async () => {
    const full = await signedInHost();
    const other = await signedInHost();
    await fillQuota(full.id, Date.now());
    mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));
    expect((await generate(full)).status).toBe(429);
    expect((await generate(other)).status).toBe(200);
  });

  it("permintaan sebelum 00.00 WIB hari ini tidak dihitung", async () => {
    const host = await signedInHost();
    await fillQuota(host.id, wibDayStart(Date.now()) - 1);
    mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));
    expect((await generate(host)).status).toBe(200);
  });

  it("permintaan tepat pukul 00.00 WIB hari ini dihitung", async () => {
    const host = await signedInHost();
    await fillQuota(host.id, wibDayStart(Date.now()));
    mockGroq(() => groqCompletion(JSON.stringify({ questions: fiveDrafts() })));
    expect((await generate(host)).status).toBe(429);
  });

  it("query kuota memakai indeks ai_generations_host_created_idx", async () => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${QUOTA_SQL}`).bind("host", 0).all<{ detail: string }>();
    expect(results.map((row) => row.detail).join("\n")).toContain("ai_generations_host_created_idx");
  });
});

describe("wibDayStart", () => {
  it("awal hari dihitung di WIB (UTC+7), bukan UTC", () => {
    // 27 Okt 01.00 WIB = 26 Okt 18.00 UTC: hari WIB sudah berganti, hari UTC belum.
    expect(wibDayStart(Date.UTC(2026, 9, 26, 18, 0))).toBe(Date.UTC(2026, 9, 26, 17, 0));
    // 26 Okt 23.59 WIB = 26 Okt 16.59 UTC: masih hari WIB yang sama, mulai 25 Okt 17.00 UTC.
    expect(wibDayStart(Date.UTC(2026, 9, 26, 16, 59))).toBe(Date.UTC(2026, 9, 25, 17, 0));
    // Tepat 00.00 WIB adalah awal hari itu sendiri.
    expect(wibDayStart(Date.UTC(2026, 9, 26, 17, 0))).toBe(Date.UTC(2026, 9, 26, 17, 0));
  });
});
