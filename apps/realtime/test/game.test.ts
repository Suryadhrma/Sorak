import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { CloseCode, GRACE_MS } from "@sorak/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connect,
  connectedHost,
  expectNext,
  initInput,
  initRoom,
  joinInfo,
  joinedPlayer,
  roomStub,
  uniquePin,
  type Client,
} from "./room.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

type Player = { client: Client; playerId: string; sessionToken: string };

/** Room di lobby: host tersambung dan pemain sudah join, semua pesan lobby sudah dibaca. */
async function lobbyWith(nicknames: string[], options: { questions?: number; mode?: "classic" | "accurate" } = {}) {
  const pin = uniquePin();
  await initRoom(pin, initInput(pin, { questions: 3, ...options }));
  const host = (await connectedHost(pin)).client;
  const players: Player[] = [];
  for (const nickname of nicknames) {
    const { client, welcome } = await joinedPlayer(pin, nickname);
    const { playerId, sessionToken } = welcome as { playerId: string; sessionToken: string };
    players.push({ client, playerId, sessionToken });
  }
  for (const _ of nicknames) await expectNext(host, { t: "player_joined" });
  for (const [i, player] of players.entries()) {
    for (let k = i; k < nicknames.length; k++) await expectNext(player.client, { t: "lobby" });
  }
  return { pin, host, players };
}

async function startedGame(nicknames: string[], options: { questions?: number; mode?: "classic" | "accurate" } = {}) {
  const game = await lobbyWith(nicknames, options);
  game.host.send({ t: "start" });
  await expectQuestionEverywhere(game, 0);
  return game;
}

async function expectQuestionEverywhere(game: { host: Client; players: Player[] }, q: number) {
  await expectNext(game.host, { t: "question", q, durationMs: 20_000 });
  for (const player of game.players) await expectNext(player.client, { t: "question", q });
}

async function expectGraceEverywhere(game: { host: Client; players: Player[] }, q: number) {
  await expectNext(game.host, { t: "grace", q, ms: GRACE_MS });
  for (const player of game.players) await expectNext(player.client, { t: "grace", q });
}

const answer = (player: Player, q: number, choice: number) => player.client.send({ t: "answer", q, choice, elapsedMs: 1000 });
const alarm = (pin: string) => runDurableObjectAlarm(roomStub(pin));

describe("satu game 3 soal, 2 pemain, 1 host", () => {
  it("Klasik: soal, jawaban, grace, reveal, lanjut, sampai podium", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi, budi] = game.players as [Player, Player];

    // Soal 1: Andi benar, Budi salah. Semua sudah menjawab, jadi grace tanpa menunggu deadline.
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received", q: 0 });
    await expectNext(game.host, { t: "answer_count", q: 0, answered: 1, total: 2 });
    answer(budi, 0, 2);
    await expectNext(budi.client, { t: "answer_received", q: 0 });
    await expectNext(game.host, { t: "answer_count", q: 0, answered: 2, total: 2 });
    await expectGraceEverywhere(game, 0);

    expect(await alarm(game.pin)).toBe(true);
    const reveal1 = await expectNext(game.host, {
      t: "reveal",
      q: 0,
      correctIndex: 1,
      counts: [0, 1, 1],
      answered: 2,
      total: 2,
      isLastQuestion: false,
    });
    expect((reveal1.leaderboard as { nickname: string; rank: number }[]).map((entry) => [entry.nickname, entry.rank])).toEqual([
      ["Andi", 1],
      ["Budi", 2],
    ]);
    const andiResult1 = await expectNext(andi.client, { t: "result", q: 0, outcome: "correct", rank: 1, streak: 1 });
    expect(andiResult1.points).toBeGreaterThan(900);
    expect(andiResult1.points).toBeLessThanOrEqual(1000);
    await expectNext(budi.client, { t: "result", q: 0, outcome: "wrong", points: 0, score: 0, rank: 2, streak: 0 });

    // Soal 2: hanya Andi menjawab; deadline lewat alarm, kombo naik.
    game.host.send({ t: "next" });
    await expectQuestionEverywhere(game, 1);
    answer(andi, 1, 1);
    await expectNext(andi.client, { t: "answer_received", q: 1 });
    await expectNext(game.host, { t: "answer_count", q: 1, answered: 1 });
    expect(await alarm(game.pin)).toBe(true);
    await expectGraceEverywhere(game, 1);
    expect(await alarm(game.pin)).toBe(true);
    await expectNext(game.host, { t: "reveal", q: 1, answered: 1, isLastQuestion: false });
    const andiResult2 = await expectNext(andi.client, { t: "result", q: 1, outcome: "correct", streak: 2 });
    expect(andiResult2.points).toBeGreaterThan(950);
    expect(andiResult2.points).toBeLessThanOrEqual(1050);
    await expectNext(budi.client, { t: "result", q: 1, outcome: "no_answer", points: 0 });

    // Soal 3 (terakhir): Budi benar, Andi salah dan kombonya putus.
    game.host.send({ t: "next" });
    await expectQuestionEverywhere(game, 2);
    answer(andi, 2, 0);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 1 });
    answer(budi, 2, 1);
    await expectNext(budi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 2 });
    await expectGraceEverywhere(game, 2);
    expect(await alarm(game.pin)).toBe(true);
    await expectNext(game.host, { t: "reveal", q: 2, isLastQuestion: true });
    await expectNext(andi.client, { t: "result", q: 2, outcome: "wrong", points: 0, streak: 0 });
    await expectNext(budi.client, { t: "result", q: 2, outcome: "correct", streak: 1 });

    game.host.send({ t: "next" });
    const podium = await expectNext(game.host, { t: "podium", playerCount: 2 });
    expect((podium.top as { nickname: string }[]).map((entry) => entry.nickname)).toEqual(["Andi", "Budi"]);
    await expectNext(andi.client, { t: "final", rank: 1, playerCount: 2, highlights: { bestStreak: 2 } });
    await expectNext(budi.client, { t: "final", rank: 2, playerCount: 2, highlights: { bestStreak: 1, biggestRankClimb: 0 } });
  });

  it("Akurat: setiap jawaban benar 1000 + kombo, berapa pun kecepatannya", async () => {
    const game = await startedGame(["Andi"], { mode: "accurate", questions: 2 });
    const [andi] = game.players as [Player];
    for (const q of [0, 1]) {
      if (q > 0) {
        game.host.send({ t: "next" });
        await expectQuestionEverywhere(game, q);
      }
      answer(andi, q, 1);
      await expectNext(andi.client, { t: "answer_received" });
      await expectNext(game.host, { t: "answer_count" });
      await expectGraceEverywhere(game, q);
      await alarm(game.pin);
      await expectNext(game.host, { t: "reveal" });
      await expectNext(andi.client, { t: "result", q, points: q === 0 ? 1000 : 1050 });
    }
  });
});

describe("kasus game", () => {
  it("start tanpa pemain -> NOT_ALLOWED_NOW", async () => {
    const pin = uniquePin();
    await initRoom(pin);
    const host = (await connectedHost(pin)).client;
    host.send({ t: "start" });
    await expectNext(host, { t: "error", code: "NOT_ALLOWED_NOW", message: "Belum ada pemain" });
  });

  it("jawaban dobel -> satu jawaban, dua answer_received", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    answer(andi, 0, 2);
    await expectNext(andi.client, { t: "answer_received", q: 0 });
    await expectNext(andi.client, { t: "answer_received", q: 0 });
    await expectNext(game.host, { t: "answer_count", answered: 1 });
    await alarm(game.pin);
    await expectGraceEverywhere(game, 0);
    await alarm(game.pin);
    await expectNext(game.host, { t: "reveal", counts: [0, 1, 0], answered: 1 });
  });

  it("jawaban untuk soal lain diabaikan", async () => {
    const game = await startedGame(["Andi"]);
    const [andi] = game.players as [Player];
    answer(andi, 2, 1);
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received", q: 0 });
  });

  it("choice di luar opsi soal -> BAD_MESSAGE", async () => {
    const game = await startedGame(["Andi"]);
    const [andi] = game.players as [Player];
    answer(andi, 0, 3);
    await expectNext(andi.client, { t: "error", code: "BAD_MESSAGE" });
  });

  it("jawaban yang tiba di grace dihitung dengan t = T (Klasik 500 poin)", async () => {
    const game = await startedGame(["Andi"]);
    const [andi] = game.players as [Player];
    await alarm(game.pin);
    await expectGraceEverywhere(game, 0);
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received", q: 0 });
    await expectNext(game.host, { t: "answer_count", answered: 1 });
    await alarm(game.pin);
    await expectNext(game.host, { t: "reveal" });
    await expectNext(andi.client, { t: "result", outcome: "correct", points: 500 });
  });

  it("pemain putus setelah menjawab -> jawabannya tetap dihitung di reveal", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi, budi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 1 });
    andi.client.close();
    await expectNext(game.host, { t: "player_left", playerId: andi.playerId, playerCount: 2 });

    await alarm(game.pin);
    await expectNext(game.host, { t: "grace" });
    await expectNext(budi.client, { t: "grace" });
    await alarm(game.pin);
    const reveal = await expectNext(game.host, { t: "reveal", counts: [0, 1, 0], answered: 1, total: 2 });
    expect((reveal.leaderboard as { playerId: string; rank: number }[])[0]).toMatchObject({ playerId: andi.playerId, rank: 1 });
    await runInDurableObject(roomStub(game.pin), async (_instance, state) => {
      expect((await state.storage.list({ prefix: "pending:" })).size).toBe(0);
    });
  });

  it("semua pemain putus di tengah soal -> tetap question sampai alarm berbunyi", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    for (const player of game.players) player.client.close();
    await expectNext(game.host, { t: "player_left" });
    await expectNext(game.host, { t: "player_left" });

    const refreshed = await connectedHost(game.pin);
    expect(refreshed.welcome).toMatchObject({ phase: "question", answered: 0 });
    await alarm(game.pin);
    await expectNext(refreshed.client, { t: "grace", q: 0 });
  });

  it("next di tahap question -> NOT_ALLOWED_NOW", async () => {
    const game = await startedGame(["Andi"]);
    game.host.send({ t: "next" });
    await expectNext(game.host, { t: "error", code: "NOT_ALLOWED_NOW" });
  });

  it("end di tengah soal -> podium dari scoreboard terakhir, soal itu tidak dinilai", async () => {
    const game = await startedGame(["Andi"]);
    const [andi] = game.players as [Player];
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count" });
    await expectGraceEverywhere(game, 0);
    game.host.send({ t: "end" });
    await expectNext(game.host, { t: "podium", top: [{ nickname: "Andi", score: 0 }], playerCount: 1 });
    await expectNext(andi.client, { t: "final", score: 0, rank: 1 });
  });

  it("host_hello di tengah soal mendapat soal, sisa waktu, dan jumlah yang menjawab", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    await expectNext(game.host, { t: "answer_count", answered: 1 });

    const refreshed = await connectedHost(game.pin);
    expect(refreshed.welcome).toMatchObject({ t: "host_welcome", phase: "question", question: { q: 0, total: 3 }, answered: 1 });
    const remainingMs = (refreshed.welcome as { remainingMs: number }).remainingMs;
    expect(remainingMs).toBeGreaterThan(15_000);
    expect(remainingMs).toBeLessThanOrEqual(20_000);
    expect(refreshed.welcome).not.toHaveProperty("question.correctIndex");
  });

  it("host_hello di tahap reveal mendapat ulang pesan reveal yang sama", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi, budi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    await expectNext(game.host, { t: "answer_count", answered: 1 });
    answer(budi, 0, 0);
    await expectNext(game.host, { t: "answer_count", answered: 2 });
    await expectNext(game.host, { t: "grace" });
    await alarm(game.pin);
    const original = await expectNext(game.host, { t: "reveal" });

    const client = await connect(game.pin, "host", "host-1");
    client.send({ t: "host_hello", v: 1 });
    await expectNext(client, { t: "host_welcome", phase: "reveal", question: null, remainingMs: null });
    const resent = await expectNext(client, { t: "reveal" });
    expect(resent).toEqual(original);
  });

  it("alarm ended -> semua socket 4000 dan storage kosong", async () => {
    const game = await startedGame(["Andi"], { questions: 1 });
    game.host.send({ t: "end" });
    await expectNext(game.host, { t: "podium" });
    expect(await alarm(game.pin)).toBe(true);
    expect(await game.host.closed).toMatchObject({ code: CloseCode.ROOM_CLOSED });
    expect(await game.players[0]?.client.closed).toMatchObject({ code: CloseCode.ROOM_CLOSED });
    await runInDurableObject(roomStub(game.pin), async (_instance, state) => {
      expect((await state.storage.list()).size).toBe(0);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it.each([
    ["join", (_token: string) => ({ t: "join", v: 1, nickname: "Telat" }), "Permainan sudah dimulai."],
    ["resume", (token: string) => ({ t: "resume", v: 1, sessionToken: token }), "Masuk ulang di tengah game tersedia di versi berikutnya."],
  ])("%s di tengah game -> GAME_ALREADY_STARTED lalu 4011", async (_label, opening, text) => {
    const game = await startedGame(["Andi"]);
    const late = await connect(game.pin, "play");
    late.send(opening(game.players[0]?.sessionToken ?? ""));
    await expectNext(late, { t: "error", code: "GAME_ALREADY_STARTED", message: text });
    expect(await late.closed).toMatchObject({ code: CloseCode.GAME_ALREADY_STARTED });
    expect(await joinInfo(game.pin)).toEqual({ status: "started", playerCount: 1 });
  });

  it("objek dikeluarkan dari memori di tengah soal, lalu alarm berbunyi -> reveal tetap benar", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi, budi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 1 });

    await evictDurableObject(roomStub(game.pin));
    await alarm(game.pin);
    await expectGraceEverywhere(game, 0);
    await alarm(game.pin);
    await expectNext(game.host, { t: "reveal", counts: [0, 1, 0], answered: 1, total: 2 });
    await expectNext(andi.client, { t: "result", outcome: "correct", rank: 1 });
    await expectNext(budi.client, { t: "result", outcome: "no_answer", rank: 2 });
  });
});

describe("biaya tulis storage", () => {
  it("satu soal menulis 8 baris; pemain yang putus memegang jawaban menambah 1 tulis dan 1 hapus", async () => {
    const game = await startedGame(["Andi", "Budi"], { questions: 2 });
    const [andi] = game.players as [Player, Player];
    // Soal 1 dimainkan dulu supaya yang diukur soal biasa, bukan soal pertama yang juga menulis roster.
    await alarm(game.pin);
    await expectGraceEverywhere(game, 0);
    await alarm(game.pin);
    await expectNext(game.host, { t: "reveal" });
    for (const player of game.players) await expectNext(player.client, { t: "result", outcome: "no_answer" });

    const writes = await countStorageWrites(game.pin);
    game.host.send({ t: "next" });
    await expectQuestionEverywhere(game, 1);
    answer(andi, 1, 1);
    await expectNext(game.host, { t: "answer_count" });
    andi.client.close();
    await expectNext(game.host, { t: "player_left" });
    await alarm(game.pin);
    await expectNext(game.host, { t: "grace" });
    await alarm(game.pin);
    await expectNext(game.host, { t: "reveal" });

    const rows = await writes();
    console.info(`baris tulis storage satu soal (1 pemain putus memegang jawaban): ${JSON.stringify(rows)}`);
    // put: state (mulai) + state (grace) + state, scoreboard, qstats (reveal) + 1 pending = 6; alarm 3x; pending dihapus 1.
    // Tanpa pemain putus: 5 put + 3 alarm = 8 baris per soal.
    expect(rows).toEqual({ put: 6, setAlarm: 3, delete: 1 });
  });
});

type StorageCounts = { put: number; setAlarm: number; delete: number };

/** Mengintip pemanggilan storage GameRoom: satu key = satu baris tulis. */
async function countStorageWrites(pin: string): Promise<() => Promise<StorageCounts>> {
  await runInDurableObject(roomStub(pin), (_instance, state) => {
    vi.spyOn(state.storage, "put");
    vi.spyOn(state.storage, "setAlarm");
    vi.spyOn(state.storage, "delete");
  });
  return () =>
    runInDurableObject(roomStub(pin), (_instance, state) => {
      const keys = (args: unknown[]) => {
        const [first] = args;
        if (typeof first === "string") return 1;
        if (Array.isArray(first)) return first.length;
        return Object.keys(first as object).length;
      };
      const sum = (mock: { mock: { calls: unknown[][] } }) => mock.mock.calls.reduce((total, args) => total + keys(args), 0);
      return {
        put: sum(vi.mocked(state.storage.put)),
        setAlarm: vi.mocked(state.storage.setAlarm).mock.calls.length,
        delete: sum(vi.mocked(state.storage.delete)),
      };
    });
}
