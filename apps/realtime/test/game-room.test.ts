import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { CloseCode, MAX_PLAYERS_PER_ROOM, ROOM_CONTROL_ORIGIN, STALE_SOCKET_MS, StorageKey } from "@sorak/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOST_ID,
  connect,
  connectedHost,
  initInput,
  initRoom,
  joinInfo,
  joinedPlayer,
  roomStub,
  uniquePin,
} from "./room.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("kontrol room", () => {
  it("init sukses membuka lobby", async () => {
    const pin = uniquePin();
    expect((await initRoom(pin)).body).toEqual({ ok: true });
    expect(await joinInfo(pin)).toEqual({ status: "open", playerCount: 0 });
  });

  it("init kedua untuk PIN yang sama ditolak pin_in_use", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    expect((await initRoom(pin)).body).toEqual({ ok: false, reason: "pin_in_use" });
  });

  it("menolak input init tidak valid", async () => {
    const pin = uniquePin();
    expect((await initRoom(pin, { ...initInput(pin), pin: "12" })).status).toBe(400);
    expect(await joinInfo(pin)).toEqual({ status: "not_found", playerCount: 0 });
  });

  it("room yang sudah lewat lobby menjawab started", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const stub = roomStub(pin);
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>(StorageKey.state);
      await state.storage.put(StorageKey.state, { ...stored, phase: "question" });
    });
    // State dibaca ulang dari storage oleh constructor setelah objek dikeluarkan dari memori.
    await evictDurableObject(stub);
    expect(await joinInfo(pin)).toEqual({ status: "started", playerCount: 0 });
  });

  it.each([
    ["GET", "/init"],
    ["POST", "/join-info"],
    ["GET", "/admin"],
  ])("%s %s di luar allowlist -> 404", async (method, path) => {
    const res = await roomStub(uniquePin()).fetch(`${ROOM_CONTROL_ORIGIN}${path}`, { method });
    expect(res.status).toBe(404);
  });

  it("/connect tanpa upgrade -> 426", async () => {
    const res = await roomStub(uniquePin()).fetch(`${ROOM_CONTROL_ORIGIN}/connect`);
    expect(res.status).toBe(426);
  });
});

describe("join", () => {
  it("pemain menerima token, host menerima player_joined, pemain lain menerima lobby", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const host = await connectedHost(pin);
    const first = await joinedPlayer(pin, "Andi");
    expect(await host.client.next()).toMatchObject({ t: "player_joined", player: { nickname: "Andi" }, playerCount: 1 });
    expect(await first.client.next()).toEqual({ t: "lobby", playerCount: 1 });

    const second = await joinedPlayer(pin, "Budi");
    expect(second.welcome).toMatchObject({
      t: "welcome",
      nickname: "Budi",
      sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      room: { pin, questionCount: 1 },
      snapshot: { phase: "lobby", playerCount: 2 },
    });
    expect(await host.client.next()).toMatchObject({ t: "player_joined", player: { nickname: "Budi" }, playerCount: 2 });
    expect(await first.client.next()).toEqual({ t: "lobby", playerCount: 2 });
  });

  it("Dimas lalu dimas -> NICKNAME_TAKEN, socket tetap terbuka dan bisa join dengan nama lain", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    await joinedPlayer(pin, "Dimas");
    const other = await connect(pin, "play");
    other.send({ t: "join", v: 1, nickname: "dimas" });
    expect(await other.next()).toMatchObject({ t: "error", code: "NICKNAME_TAKEN" });
    other.send({ t: "join", v: 1, nickname: "Dimas 2" });
    expect(await other.next()).toMatchObject({ t: "welcome", nickname: "Dimas 2" });
  });

  it("nickname berisi emoji -> NICKNAME_INVALID tanpa memutus koneksi", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await connect(pin, "play");
    player.send({ t: "join", v: 1, nickname: "Dimas🔥" });
    expect(await player.next()).toMatchObject({ t: "error", code: "NICKNAME_INVALID" });
    player.send({ t: "join", v: 1, nickname: "Dimas" });
    expect(await player.next()).toMatchObject({ t: "welcome" });
  });

  it("nickname dipegang socket basi -> join berhasil dan host menerima player_left", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const host = await connectedHost(pin);
    const stale = await joinedPlayer(pin, "Dimas");
    expect(await host.client.next()).toMatchObject({ t: "player_joined" });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + STALE_SOCKET_MS + 1000);
    const fresh = await joinedPlayer(pin, "dimas");
    expect(fresh.welcome).toMatchObject({ t: "welcome", nickname: "dimas" });
    expect(await host.client.next()).toMatchObject({
      t: "player_left",
      playerId: (stale.welcome as { playerId: string }).playerId,
      kicked: false,
    });
    expect(await stale.client.closed).toMatchObject({ code: CloseCode.GOING_AWAY });
  });

  it("room penuh -> ROOM_FULL dan 4010; satu socket basi memberi tempat", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const started = performance.now();
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) await joinedPlayer(pin, `Pemain ${i}`);
    expect(await joinInfo(pin)).toEqual({ status: "full", playerCount: MAX_PLAYERS_PER_ROOM });

    const late = await connect(pin, "play");
    late.send({ t: "join", v: 1, nickname: "Telat" });
    expect(await late.next()).toMatchObject({ t: "error", code: "ROOM_FULL" });
    expect(await late.closed).toMatchObject({ code: CloseCode.ROOM_FULL });
    console.info(`200 pemain join dalam ${Math.round(performance.now() - started)} ms`);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + STALE_SOCKET_MS + 1000);
    const afterStale = await joinedPlayer(pin, "Telat");
    expect(afterStale.welcome).toMatchObject({ t: "welcome", nickname: "Telat" });
  });
});

describe("pesan pertama dan batas", () => {
  it("answer sebelum join -> NOT_JOINED", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await connect(pin, "play");
    player.send({ t: "answer", q: 0, choice: 1, elapsedMs: 1000 });
    expect(await player.next()).toMatchObject({ t: "error", code: "NOT_JOINED" });
  });

  it("versi protokol 2 -> UNSUPPORTED_VERSION lalu 4005", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await connect(pin, "play");
    player.send({ t: "join", v: 2, nickname: "Dimas" });
    expect(await player.next()).toMatchObject({ t: "error", code: "UNSUPPORTED_VERSION" });
    expect(await player.closed).toMatchObject({ code: CloseCode.UNSUPPORTED_VERSION });
  });

  it("tiga pesan sampah beruntun -> 4009", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await connect(pin, "play");
    for (const junk of ["{rusak", "[]", JSON.stringify({ t: "give_me_points" })]) player.sendRaw(junk);
    expect(await player.closed).toMatchObject({ code: CloseCode.TOO_MANY_INVALID });
  });

  it("pesan valid me-reset hitungan pesan sampah", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await connect(pin, "play");
    player.sendRaw("{rusak");
    player.sendRaw("{rusak");
    player.send({ t: "join", v: 1, nickname: "Dimas" });
    player.sendRaw("{rusak");
    player.sendRaw("{rusak");
    const received = [];
    // Pemain yang baru join juga menerima broadcast lobby.
    for (let i = 0; i < 6; i++) received.push((await player.next()) as { t: string; code?: string });
    expect(received.map((message) => message.code ?? message.t)).toEqual([
      "BAD_MESSAGE",
      "BAD_MESSAGE",
      "welcome",
      "lobby",
      "BAD_MESSAGE",
      "BAD_MESSAGE",
    ]);
  });

  it("11 pesan dalam satu detik -> 4008", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await connect(pin, "play");
    for (let i = 0; i < 11; i++) player.send({ t: "react", reaction: "clap" });
    expect(await player.closed).toMatchObject({ code: CloseCode.RATE_LIMITED });
  });
});

describe("resume", () => {
  it("token dari socket yang masih terbuka -> socket lama ditutup 4002, welcome tanpa token", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const original = await joinedPlayer(pin, "Dimas");
    const { sessionToken, playerId } = original.welcome as { sessionToken: string; playerId: string };

    const again = await connect(pin, "play");
    again.send({ t: "resume", v: 1, sessionToken });
    const welcome = await again.next();
    expect(welcome).toMatchObject({ t: "welcome", playerId, nickname: "Dimas" });
    expect(welcome).not.toHaveProperty("sessionToken");
    expect(await original.client.closed).toMatchObject({ code: CloseCode.REPLACED });
    expect(await joinInfo(pin)).toEqual({ status: "open", playerCount: 1 });
  });

  it("token tidak dikenal -> SESSION_INVALID lalu 4003", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await connect(pin, "play");
    player.send({ t: "resume", v: 1, sessionToken: "A".repeat(22) });
    expect(await player.next()).toMatchObject({ t: "error", code: "SESSION_INVALID" });
    expect(await player.closed).toMatchObject({ code: CloseCode.SESSION_INVALID });
  });
});

describe("host", () => {
  it("host_hello -> host_welcome berisi pemain yang sudah ada", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    await joinedPlayer(pin, "Andi");
    const host = await connectedHost(pin);
    expect(host.welcome).toMatchObject({
      t: "host_welcome",
      phase: "lobby",
      room: { pin },
      players: [{ nickname: "Andi", connected: true }],
      question: null,
      answered: 0,
    });
  });

  it("hostId salah -> 4004", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const intruder = await connect(pin, "host", "host-lain");
    expect(await intruder.closed).toMatchObject({ code: CloseCode.ROOM_NOT_FOUND });
  });

  it.each(["play", "host"] as const)("room tidak ada -> 4004 (%s)", async (route) => {
    const client = await connect(uniquePin(), route, HOST_ID);
    expect(await client.closed).toMatchObject({ code: CloseCode.ROOM_NOT_FOUND });
  });

  it("start belum tersedia -> NOT_ALLOWED_NOW", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const host = await connectedHost(pin);
    host.client.send({ t: "start" });
    expect(await host.client.next()).toMatchObject({ t: "error", code: "NOT_ALLOWED_NOW" });
  });
});

describe("putus dan penutupan room", () => {
  it("pemain menutup socket -> host menerima player_left", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const host = await connectedHost(pin);
    const player = await joinedPlayer(pin, "Andi");
    expect(await host.client.next()).toMatchObject({ t: "player_joined" });
    player.client.close();
    expect(await host.client.next()).toMatchObject({ t: "player_left", kicked: false, playerCount: 0 });
  });

  it("end di lobby -> semua socket 4000 dan storage kosong", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const host = await connectedHost(pin);
    const player = await joinedPlayer(pin, "Andi");
    await host.client.next();
    host.client.send({ t: "end" });
    expect(await host.client.closed).toMatchObject({ code: CloseCode.ROOM_CLOSED });
    expect(await player.client.closed).toMatchObject({ code: CloseCode.ROOM_CLOSED });

    await runInDurableObject(roomStub(pin), async (_instance, state) => {
      expect((await state.storage.list()).size).toBe(0);
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect((await initRoom(pin)).body).toEqual({ ok: true });
  });

  it("alarm lobby tanpa host -> room ditutup", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await joinedPlayer(pin, "Andi");
    expect(await runDurableObjectAlarm(roomStub(pin))).toBe(true);
    expect(await player.client.closed).toMatchObject({ code: CloseCode.ROOM_CLOSED });
    expect(await joinInfo(pin)).toEqual({ status: "not_found", playerCount: 0 });
  });

  it("alarm lobby dengan host -> alarm dipasang ulang", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    await connectedHost(pin);
    expect(await runDurableObjectAlarm(roomStub(pin))).toBe(true);
    await runInDurableObject(roomStub(pin), async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    expect(await joinInfo(pin)).toEqual({ status: "open", playerCount: 0 });
  });
});

describe("hibernasi", () => {
  it("roster dan state pulih setelah objek dikeluarkan dari memori", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const player = await joinedPlayer(pin, "Andi");
    expect(await player.client.next()).toEqual({ t: "lobby", playerCount: 1 });
    await evictDurableObject(roomStub(pin));

    const host = await connectedHost(pin);
    expect(host.welcome).toMatchObject({ t: "host_welcome", room: { pin }, players: [{ nickname: "Andi" }] });
    // Socket pemain yang ikut hibernasi masih bisa dipakai.
    player.client.send({ t: "answer", q: 0, choice: 1, elapsedMs: 1000 });
    player.client.send({ t: "join", v: 1, nickname: "Andi" });
    expect(await player.client.next()).toMatchObject({ t: "error", code: "NOT_ALLOWED_NOW" });
  });
});
