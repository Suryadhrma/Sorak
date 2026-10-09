import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { CloseCode, PlayerAttachment } from "@sorak/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alarm,
  answer,
  connect,
  countStorageWrites,
  expectGraceEverywhere,
  expectNext,
  expectQuestionEverywhere,
  lobbyWith,
  roomStub,
  startedGame,
  type Client,
  type Player,
} from "./room.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attachment pemain yang sedang tersambung, langsung dari socket di GameRoom. */
async function playerAttachments(pin: string): Promise<PlayerAttachment[]> {
  return runInDurableObject(roomStub(pin), (_instance, state) =>
    state.getWebSockets().flatMap((ws) => {
      const parsed = PlayerAttachment.safeParse(ws.deserializeAttachment());
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

async function resumeAs(pin: string, player: Player): Promise<Client> {
  const client = await connect(pin, "play");
  client.send({ t: "resume", v: 1, sessionToken: player.sessionToken });
  return client;
}

/** Soal 0 selesai sampai reveal: semua pemain menjawab benar, lalu alarm grace. */
async function playFirstQuestion(game: Awaited<ReturnType<typeof startedGame>>) {
  for (const player of game.players) {
    answer(player, 0, 1);
    await expectNext(player.client, { t: "answer_received", q: 0 });
    await expectNext(game.host, { t: "answer_count" });
  }
  await expectGraceEverywhere(game, 0);
  await alarm(game.pin);
  await expectNext(game.host, { t: "reveal", q: 0 });
  for (const player of game.players) await expectNext(player.client, { t: "result", q: 0 });
}

describe("ack", () => {
  it("ack pertama mengisi latencyMs dan ackedQ; ack kedua untuk soal yang sama tidak mengubahnya", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi] = game.players as [Player, Player];
    andi.client.send({ t: "ack", q: 0 });
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    const [first] = (await playerAttachments(game.pin)).filter((p) => p.playerId === andi.playerId);
    expect(first).toMatchObject({ ackedQ: 0, latencyMs: expect.any(Number) });

    await sleep(300);
    andi.client.send({ t: "ack", q: 0 });
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    const [second] = (await playerAttachments(game.pin)).filter((p) => p.playerId === andi.playerId);
    expect(second?.latencyMs).toBe(first?.latencyMs);
  });

  it("ack untuk soal lain diabaikan", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi] = game.players as [Player, Player];
    andi.client.send({ t: "ack", q: 2 });
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    const [attachment] = (await playerAttachments(game.pin)).filter((p) => p.playerId === andi.playerId);
    expect(attachment).toMatchObject({ ackedQ: null, latencyMs: null });
  });
});

describe("resume di tengah game", () => {
  it("di tahap question: snapshot berisi soal, sisa waktu, belum menjawab, dan skor dari reveal sebelumnya", async () => {
    const game = await startedGame(["Andi", "Budi"], { questions: 2 });
    const [andi] = game.players as [Player, Player];
    await playFirstQuestion(game);
    game.host.send({ t: "next" });
    await expectQuestionEverywhere(game, 1);

    andi.client.close();
    await expectNext(game.host, { t: "player_left", playerId: andi.playerId, kicked: false, playerCount: 2 });

    const writes = await countStorageWrites(game.pin);
    const back = await resumeAs(game.pin, andi);
    const welcome = await expectNext(back, {
      t: "welcome",
      playerId: andi.playerId,
      snapshot: { phase: "question", question: { q: 1 }, answered: false, rank: 1, playerCount: 2 },
    });
    expect(welcome).not.toHaveProperty("sessionToken");
    expect(welcome).not.toHaveProperty("snapshot.question.correctIndex");
    const snapshot = welcome.snapshot as { remainingMs: number; score: number };
    expect(snapshot.remainingMs).toBeGreaterThan(15_000);
    expect(snapshot.remainingMs).toBeLessThanOrEqual(20_000);
    expect(snapshot.score).toBeGreaterThan(900);
    await expectNext(game.host, { t: "player_joined", player: { playerId: andi.playerId, connected: true }, playerCount: 2 });
    expect(await writes()).toEqual({ put: 0, setAlarm: 0, delete: 0 });
  });

  it("menjawab, putus (pending tertulis), lalu resume: answered true dan jawabannya dihitung sekali", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi, budi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 1 });
    andi.client.close();
    await expectNext(game.host, { t: "player_left" });

    const back = await resumeAs(game.pin, andi);
    await expectNext(back, { t: "welcome", snapshot: { phase: "question", answered: true } });
    await expectNext(game.host, { t: "player_joined" });

    answer(budi, 0, 2);
    await expectNext(budi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 2, total: 2 });
    await expectNext(game.host, { t: "grace" });
    await alarm(game.pin);
    await expectNext(game.host, { t: "reveal", counts: [0, 1, 1], answered: 2 });
  });

  it("resume dari socket kedua saat socket pertama masih terbuka: lama ditutup 4002, host tidak menerima player_left, jawaban pindah", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 1 });

    const second = await resumeAs(game.pin, andi);
    await expectNext(second, { t: "welcome", snapshot: { answered: true } });
    expect(await andi.client.closed).toMatchObject({ code: CloseCode.REPLACED });
    // Pesan host berikutnya langsung player_joined: tidak ada player_left untuk socket yang digantikan.
    await expectNext(game.host, { t: "player_joined", player: { playerId: andi.playerId, connected: true } });
    answer({ ...andi, client: second }, 0, 2);
    await expectNext(second, { t: "answer_received", q: 0 });
  });

  it("di tahap reveal: welcome lalu result yang sama dengan yang diterima pemain lain", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi] = game.players as [Player, Player];
    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count" });
    await alarm(game.pin);
    await expectGraceEverywhere(game, 0);
    await alarm(game.pin);
    await expectNext(game.host, { t: "reveal" });
    const original = await expectNext(andi.client, { t: "result", q: 0 });

    const back = await resumeAs(game.pin, andi);
    await expectNext(back, { t: "welcome", snapshot: { phase: "reveal", question: null, remainingMs: null } });
    expect(await back.next()).toEqual(original);
  });

  it("di tahap ended: welcome lalu final", async () => {
    const game = await startedGame(["Andi"], { questions: 1 });
    const [andi] = game.players as [Player];
    game.host.send({ t: "end" });
    await expectNext(game.host, { t: "podium" });
    const original = await expectNext(andi.client, { t: "final" });

    const back = await resumeAs(game.pin, andi);
    await expectNext(back, { t: "welcome", snapshot: { phase: "ended" } });
    expect(await back.next()).toEqual(original);
  });

  it("token tidak dikenal -> SESSION_INVALID lalu 4003", async () => {
    const game = await startedGame(["Andi"]);
    const stranger = await resumeAs(game.pin, { ...(game.players[0] as Player), sessionToken: "Z".repeat(22) });
    await expectNext(stranger, { t: "error", code: "SESSION_INVALID" });
    expect(await stranger.closed).toMatchObject({ code: CloseCode.SESSION_INVALID });
  });

  it("objek dikeluarkan dari memori di tengah soal, lalu resume: roster dari storage, tetap berhasil", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi] = game.players as [Player, Player];
    andi.client.close();
    await expectNext(game.host, { t: "player_left" });
    await evictDurableObject(roomStub(game.pin));

    const back = await resumeAs(game.pin, andi);
    await expectNext(back, { t: "welcome", playerId: andi.playerId, snapshot: { phase: "question", question: { q: 0 } } });
  });
});

describe("kick", () => {
  it("di lobby: socket ditutup 4001, host menerima player_left kicked, pemain lain menerima lobby", async () => {
    const game = await lobbyWith(["Andi", "Budi"]);
    const [andi, budi] = game.players as [Player, Player];
    game.host.send({ t: "kick", playerId: andi.playerId });
    expect(await andi.client.closed).toMatchObject({ code: CloseCode.KICKED });
    await expectNext(game.host, { t: "player_left", playerId: andi.playerId, kicked: true, playerCount: 1 });
    await expectNext(budi.client, { t: "lobby", playerCount: 1 });
  });

  it("di tengah soal: total berkurang, reveal tanpa pemain itu, token-nya ditolak 4003", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [andi, budi] = game.players as [Player, Player];
    answer(budi, 0, 2);
    await expectNext(budi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 1, total: 2 });
    budi.client.close();
    await expectNext(game.host, { t: "player_left", playerId: budi.playerId, kicked: false });

    const writes = await countStorageWrites(game.pin);
    game.host.send({ t: "kick", playerId: budi.playerId });
    await expectNext(game.host, { t: "player_left", playerId: budi.playerId, kicked: true, playerCount: 1 });
    const rows = await writes();
    console.info(`baris tulis storage untuk kick di tengah soal (pemain punya jawaban pending): ${JSON.stringify(rows)}`);
    // Satu put berisi roster + scoreboard, dan jawaban pending-nya dihapus.
    expect(rows).toEqual({ put: 2, setAlarm: 0, delete: 1 });

    answer(andi, 0, 1);
    await expectNext(andi.client, { t: "answer_received" });
    await expectNext(game.host, { t: "answer_count", answered: 1, total: 1 });
    await expectNext(game.host, { t: "grace" });
    await alarm(game.pin);
    const reveal = await expectNext(game.host, { t: "reveal", counts: [0, 1, 0], answered: 1, total: 1 });
    expect((reveal.leaderboard as { playerId: string }[]).map((entry) => entry.playerId)).toEqual([andi.playerId]);

    const back = await resumeAs(game.pin, budi);
    expect(await back.closed).toMatchObject({ code: CloseCode.SESSION_INVALID });
  });

  it("pemain yang sedang tersambung di tengah game ditutup 4001", async () => {
    const game = await startedGame(["Andi", "Budi"]);
    const [, budi] = game.players as [Player, Player];
    game.host.send({ t: "kick", playerId: budi.playerId });
    expect(await budi.client.closed).toMatchObject({ code: CloseCode.KICKED });
    await expectNext(game.host, { t: "player_left", playerId: budi.playerId, kicked: true, playerCount: 1 });
  });

  it("playerId tidak dikenal -> NOT_ALLOWED_NOW", async () => {
    const game = await startedGame(["Andi"]);
    game.host.send({ t: "kick", playerId: "orang-lain" });
    await expectNext(game.host, { t: "error", code: "NOT_ALLOWED_NOW", message: "Pemain tidak ditemukan" });
  });
});

describe("moderasi nickname", () => {
  it("nama kasar -> NICKNAME_REJECTED, socket tetap terbuka, lalu nama lain berhasil di socket yang sama", async () => {
    const game = await lobbyWith([]);
    const player = await connect(game.pin, "play");
    player.send({ t: "join", v: 1, nickname: "4nj1ng" });
    await expectNext(player, { t: "error", code: "NICKNAME_REJECTED", message: "Nama ini tidak bisa dipakai. Coba nama lain." });
    player.send({ t: "join", v: 1, nickname: "Dimas" });
    await expectNext(player, { t: "welcome", nickname: "Dimas" });
  });
});

describe("kompensasi latency end-to-end", () => {
  it("pemain dengan jeda besar (ack ditunda) dan klaim jujur mendapat poin hampir sama dengan pemain tanpa jeda", async () => {
    const game = await startedGame(["Cepat", "Lambat"]);
    const [cepat, lambat] = game.players as [Player, Player];
    const reactionMs = 500;

    // Cepat: ack langsung, menjawab setelah 500 ms.
    cepat.client.send({ t: "ack", q: 0 });
    // Lambat: seolah jeda satu arah 800 ms. Soal sampai di HP 800 ms setelah dikirim, ack tiba di server
    // 1.600 ms, dan jawaban (reaksi 500 ms) tiba 800 + 500 + 800 = 2.100 ms setelah soal dikirim.
    await sleep(reactionMs);
    cepat.client.send({ t: "answer", q: 0, choice: 1, elapsedMs: reactionMs });
    await expectNext(cepat.client, { t: "answer_received" });
    await sleep(1600 - reactionMs);
    lambat.client.send({ t: "ack", q: 0 });
    await sleep(reactionMs);
    lambat.client.send({ t: "answer", q: 0, choice: 1, elapsedMs: reactionMs });
    await expectNext(lambat.client, { t: "answer_received" });

    await expectNext(game.host, { t: "answer_count", answered: 1 });
    await expectNext(game.host, { t: "answer_count", answered: 2 });
    await expectGraceEverywhere(game, 0);
    await alarm(game.pin);
    const fast = (await expectNext(cepat.client, { t: "result", outcome: "correct" })).points as number;
    const slow = (await expectNext(lambat.client, { t: "result", outcome: "correct" })).points as number;
    console.info(`kompensasi end-to-end: cepat ${fast}, lambat ${slow}`);
    // Spec meminta di bawah 5%, tapi untuk soal 20 detik rumus tanpa kompensasi pun hanya selisih sekitar 4%
    // (987 vs 947, dibuktikan dengan uji mutasi). Batas 1% memastikan test ini benar-benar menguji kompensasinya.
    expect(Math.abs(fast - slow) / fast).toBeLessThan(0.01);
  });
});
