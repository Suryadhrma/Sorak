import { CloseCode, type HostServerMessage, type PlayerServerMessage, type PlayerSnapshot, type RosterEntry } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { remainingMs } from "../src/countdown.ts";
import { applyRosterMessage, disconnectedCount, hostScreen, type HostView } from "../src/host-screen.ts";
import { initialPlayerScreen, playerScreen, type PlayerEvent, type PlayerScreen, type PlayerView } from "../src/player-screen.ts";

const room = { pin: "123456", scoringMode: "classic", teamMode: false, questionCount: 3 } as const;
const question = { q: 0, total: 3, prompt: "Planet terbesar?", options: ["Mars", "Jupiter", "Venus"], durationMs: 20_000, imageUrl: null };
const andi: RosterEntry = { playerId: "p1", nickname: "Andi", teamSize: null, connected: true };
const budi: RosterEntry = { playerId: "p2", nickname: "Budi", teamSize: null, connected: true };

const welcome: PlayerServerMessage = {
  t: "welcome",
  v: 1,
  playerId: "p1",
  nickname: "Andi",
  sessionToken: "AbCdEfGhIjKlMnOpQrStUv",
  room,
  snapshot: { phase: "lobby", question: null, remainingMs: null, answered: false, score: 0, streak: 0, rank: null, playerCount: 2 },
};

/** Welcome setelah tersambung lagi di tengah game: snapshot membawa tahap, soal, dan sisa waktu. */
const resumedWelcome = (snapshot: Partial<PlayerSnapshot>): PlayerServerMessage => ({
  t: "welcome",
  v: 1,
  playerId: "p1",
  nickname: "Andi",
  room,
  snapshot: { phase: "question", question, remainingMs: 7000, answered: false, score: 0, streak: 0, rank: 1, playerCount: 2, ...snapshot },
});

const result: PlayerServerMessage = { t: "result", q: 0, outcome: "correct", correctIndex: 1, points: 950, score: 950, rank: 1, streak: 1 };

function playThrough(events: PlayerEvent[]): PlayerView[] {
  const views: PlayerView[] = [];
  let screen: PlayerScreen = initialPlayerScreen;
  for (const event of events) {
    screen = playerScreen(screen, event);
    views.push(screen.view);
  }
  return views;
}

const server = (message: PlayerServerMessage, at = 0): PlayerEvent => ({ type: "server", message, at });

describe("layar siswa", () => {
  it("welcome -> question -> answer_received -> grace -> result -> final", () => {
    const views = playThrough([
      server(welcome),
      server({ t: "question", ...question }, 1234),
      { type: "answer_sent", choice: 1 },
      server({ t: "answer_received", q: 0 }),
      server({ t: "grace", q: 0, ms: 2000 }),
      server(result),
      server({
        t: "final",
        gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        score: 950,
        rank: 1,
        playerCount: 2,
        highlights: { bestStreak: 1, confidentCorrect: 0, biggestRankClimb: 0, fastestCorrectMs: 1000 },
      }),
    ]);
    expect(views.map((view) => view.kind)).toEqual(["lobby", "question", "question", "question", "grace", "result", "final"]);
    expect(views[1]).toMatchObject({ question: { q: 0, prompt: "Planet terbesar?" }, startedAt: 1234, choice: null, confirmed: false });
    expect(views[1]).not.toHaveProperty("question.t");
    expect(views[2]).toMatchObject({ choice: 1, confirmed: false });
    expect(views[3]).toMatchObject({ choice: 1, confirmed: true });
    expect(views[4]).toMatchObject({ answered: true });
    expect(views[5]).toMatchObject({ result: { outcome: "correct", points: 950, rank: 1 } });
    expect(views[6]).toMatchObject({ final: { score: 950, rank: 1, playerCount: 2 } });
  });

  it("tersambung lagi di tengah soal: hitung mundur dari sisa waktu, jawaban antrean dikirim ulang lalu dikonfirmasi", () => {
    const views = playThrough([
      server(resumedWelcome({ remainingMs: 7000, answered: false }), 500),
      { type: "answer_sent", choice: 1 },
      server({ t: "answer_received", q: 0 }),
      server({ t: "grace", q: 0, ms: 2000 }),
      server(result),
    ]);
    expect(views[0]).toMatchObject({ kind: "question", startedAt: 500, durationMs: 7000, choice: null, confirmed: false });
    expect(views[1]).toMatchObject({ kind: "question", choice: 1, confirmed: false });
    expect(views[2]).toMatchObject({ kind: "question", choice: 1, confirmed: true });
    expect(views[3]).toMatchObject({ kind: "grace", answered: true });
    expect(views[4]).toMatchObject({ kind: "result", result: { points: 950 } });
  });

  it("snapshot answered: jawaban sudah di server, tombol terkunci tanpa menekan lagi", () => {
    const [view] = playThrough([server(resumedWelcome({ answered: true }))]);
    expect(view).toMatchObject({ kind: "question", choice: null, confirmed: true });
  });

  it("tersambung lagi saat grace lalu jawaban antrean dikonfirmasi: layar grace ikut berubah", () => {
    const views = playThrough([server(resumedWelcome({ phase: "grace", remainingMs: null })), server({ t: "answer_received", q: 0 })]);
    expect(views[0]).toMatchObject({ kind: "grace", answered: false });
    expect(views[1]).toMatchObject({ kind: "grace", answered: true });
  });

  it("tersambung lagi saat reveal: menunggu result yang dikirim ulang server", () => {
    const views = playThrough([server(resumedWelcome({ phase: "reveal", remainingMs: null })), server(result)]);
    expect(views[0]?.kind).toBe("syncing");
    expect(views[1]).toMatchObject({ kind: "result", result: { points: 950 } });
  });

  it("tidak menjawab -> grace tanpa jawaban", () => {
    const views = playThrough([server(welcome), server({ t: "question", ...question }), server({ t: "grace", q: 0, ms: 2000 })]);
    expect(views.at(-1)).toMatchObject({ kind: "grace", answered: false });
  });

  it("jawaban hanya bisa dipilih sekali per soal", () => {
    const views = playThrough([server(welcome), server({ t: "question", ...question }), { type: "answer_sent", choice: 2 }, { type: "answer_sent", choice: 0 }]);
    expect(views.at(-1)).toMatchObject({ choice: 2 });
  });

  it("answer_received untuk soal lain tidak mengonfirmasi jawaban ini", () => {
    const views = playThrough([server(welcome), server({ t: "question", ...question }), { type: "answer_sent", choice: 1 }, server({ t: "answer_received", q: 5 })]);
    expect(views.at(-1)).toMatchObject({ confirmed: false });
  });

  it("close setelah final tidak menimpa skor akhir", () => {
    const views = playThrough([
      server(welcome),
      server({
        t: "final",
        gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        score: 0,
        rank: 1,
        playerCount: 1,
        highlights: { bestStreak: 0, confidentCorrect: 0, biggestRankClimb: 0, fastestCorrectMs: null },
      }),
      { type: "ended", code: CloseCode.ROOM_CLOSED },
    ]);
    expect(views.at(-1)?.kind).toBe("final");
  });

  it("close 4000: di lobby room dibatalkan guru, setelah game berjalan berarti game selesai", () => {
    const lobby = playThrough([server(welcome), { type: "ended", code: CloseCode.ROOM_CLOSED }]);
    expect(lobby.at(-1)).toEqual({ kind: "ended", message: "Room ditutup oleh guru.", takeOver: false });

    const game = playThrough([server(welcome), server({ t: "question", ...question }), server(result), { type: "ended", code: CloseCode.ROOM_CLOSED }]);
    expect(game.at(-1)).toEqual({ kind: "ended", message: "Game sudah selesai.", takeOver: false });
  });

  it("close 4003: di lobby kembali ke form nickname, di tengah game tidak bisa masuk lagi", () => {
    const lobby = playThrough([server(welcome), { type: "ended", code: CloseCode.SESSION_INVALID }]);
    expect(lobby.at(-1)).toEqual({ kind: "nickname", error: null, busy: false });

    const game = playThrough([server(resumedWelcome({})), { type: "ended", code: CloseCode.SESSION_INVALID }]);
    expect(game.at(-1)).toMatchObject({ kind: "ended", message: expect.stringContaining("Game sudah berjalan"), takeOver: false });
  });

  it("close 4001 dikeluarkan guru; 4002 dibuka di tempat lain menawarkan Pakai di sini", () => {
    const kicked = playThrough([server(welcome), { type: "ended", code: CloseCode.KICKED }]);
    expect(kicked.at(-1)).toEqual({ kind: "ended", message: "Kamu dikeluarkan dari ruang ini oleh guru.", takeOver: false });

    const replaced = playThrough([server(welcome), { type: "ended", code: CloseCode.REPLACED }]);
    expect(replaced.at(-1)).toMatchObject({ kind: "ended", takeOver: true });
  });

  it("close lain memakai teks umum", () => {
    const views = playThrough([server(welcome), server({ t: "question", ...question }), { type: "ended", code: CloseCode.GAME_ALREADY_STARTED }]);
    expect(views.at(-1)).toEqual({ kind: "ended", message: "Permainan sudah dimulai.", takeOver: false });
  });

  it("error nickname kembali ke form; soal sebelum welcome diabaikan", () => {
    const views = playThrough([
      server({ t: "question", ...question }),
      server({ t: "error", code: "NICKNAME_TAKEN", message: "x" }),
      server({ t: "error", code: "NICKNAME_REJECTED", message: "x" }),
    ]);
    expect(views[0]?.kind).toBe("connecting");
    expect(views[1]).toMatchObject({ kind: "nickname", busy: false, error: expect.stringContaining("sudah dipakai") });
    expect(views[2]).toMatchObject({ kind: "nickname", error: "Nama ini tidak bisa dipakai. Coba nama lain." });
  });
});

function hostThrough(messages: HostServerMessage[], at = 0): HostView[] {
  const views: HostView[] = [];
  let view: HostView = { kind: "connecting" };
  for (const message of messages) {
    view = hostScreen(view, { type: "server", message, at });
    views.push(view);
  }
  return views;
}

const hostWelcome = (patch: Partial<Extract<HostServerMessage, { t: "host_welcome" }>> = {}): HostServerMessage => ({
  t: "host_welcome",
  v: 1,
  room,
  phase: "lobby",
  players: [],
  question: null,
  remainingMs: null,
  answered: 0,
  ...patch,
});

const reveal: HostServerMessage = {
  t: "reveal",
  q: 0,
  correctIndex: 1,
  counts: [0, 2, 0],
  answered: 2,
  total: 2,
  leaderboard: [
    { playerId: "p1", nickname: "Andi", teamSize: null, score: 980, delta: 980, rank: 1 },
    { playerId: "p2", nickname: "Budi", teamSize: null, score: 900, delta: 900, rank: 2 },
  ],
  isLastQuestion: false,
};

describe("layar guru", () => {
  it("lobby -> question -> answer_count -> grace -> reveal -> podium", () => {
    const views = hostThrough([
      hostWelcome(),
      { t: "player_joined", player: andi, playerCount: 1 },
      { t: "player_joined", player: budi, playerCount: 2 },
      { t: "question", ...question },
      { t: "answer_count", q: 0, answered: 1, total: 2 },
      { t: "answer_count", q: 0, answered: 2, total: 2 },
      { t: "grace", q: 0, ms: 2000 },
      reveal,
      { t: "podium", gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", top: reveal.t === "reveal" ? reveal.leaderboard : [], playerCount: 2 },
    ]);
    expect(views.map((view) => view.kind)).toEqual(["lobby", "lobby", "lobby", "question", "question", "question", "grace", "reveal", "ended"]);
    expect(views[2]).toMatchObject({ base: { players: [andi, budi] } });
    expect(views[3]).toMatchObject({ question: { prompt: "Planet terbesar?" }, durationMs: 20_000, answered: 0, total: 2 });
    expect(views[5]).toMatchObject({ answered: 2, total: 2 });
    expect(views[6]).toMatchObject({ kind: "grace", question: { q: 0 }, answered: 2 });
    expect(views[7]).toMatchObject({ kind: "reveal", question: { options: ["Mars", "Jupiter", "Venus"] }, reveal: { correctIndex: 1 } });
    expect(views[8]).toMatchObject({ kind: "ended", podium: { playerCount: 2 } });
  });

  it("refresh di tengah soal: hitung mundur dari sisa waktu server", () => {
    const views = hostThrough([hostWelcome({ phase: "question", players: [andi, budi], question, remainingMs: 7000, answered: 1 })], 500);
    expect(views[0]).toMatchObject({ kind: "question", startedAt: 500, durationMs: 7000, answered: 1, total: 2 });
  });

  it("refresh di reveal: menunggu reveal yang dikirim ulang, teks pilihan dari host_welcome", () => {
    const views = hostThrough([hostWelcome({ phase: "reveal", players: [andi, budi], question }), reveal]);
    expect(views[0]?.kind).toBe("syncing");
    expect(views[1]).toMatchObject({ kind: "reveal", question: { options: ["Mars", "Jupiter", "Venus"] } });
  });

  it("pemain keluar di lobby dibuang dari daftar; di tengah game tetap ada, ditandai tidak tersambung", () => {
    const lobby = hostThrough([hostWelcome({ players: [andi, budi] }), { t: "player_left", playerId: "p1", kicked: false, playerCount: 1 }]);
    expect(lobby.at(-1)).toMatchObject({ base: { players: [budi] } });

    const game = hostThrough([
      hostWelcome({ phase: "question", players: [andi, budi], question, remainingMs: 5000 }),
      { t: "player_left", playerId: "p1", kicked: false, playerCount: 2 },
    ]);
    expect(game.at(-1)).toMatchObject({ base: { players: [{ ...andi, connected: false }, budi] } });
  });

  it("pemain putus lalu tersambung lagi di tengah game: tetap satu baris, kembali tersambung", () => {
    const views = hostThrough([
      hostWelcome({ phase: "question", players: [andi, budi], question, remainingMs: 5000 }),
      { t: "player_left", playerId: "p1", kicked: false, playerCount: 2 },
      { t: "player_joined", player: andi, playerCount: 2 },
    ]);
    const disconnected = views[1];
    const back = views[2];
    if (disconnected?.kind !== "question" || back?.kind !== "question") throw new Error("bukan layar soal");
    expect(disconnectedCount(disconnected.base.players)).toBe(1);
    expect(back.base.players.filter((player) => player.playerId === "p1")).toEqual([andi]);
    expect(disconnectedCount(back.base.players)).toBe(0);
  });

  it("pemain di-kick di tengah game dibuang dari daftar, bukan ditandai terputus", () => {
    const views = hostThrough([
      hostWelcome({ phase: "reveal", players: [andi, budi], question }),
      reveal,
      { t: "player_left", playerId: "p2", kicked: true, playerCount: 1 },
    ]);
    expect(views.at(-1)).toMatchObject({ kind: "reveal", base: { players: [andi] } });
  });

  it("close dari server menjadi layar tertutup dengan teksnya", () => {
    const [lobby] = hostThrough([hostWelcome()]);
    if (!lobby) throw new Error("tidak ada tampilan");
    expect(hostScreen(lobby, { type: "closed", code: CloseCode.ROOM_NOT_FOUND })).toEqual({
      kind: "closed",
      message: "Room tidak ditemukan, atau bukan milik akun ini.",
    });
  });

  it("error dari server tampil sebagai pemberitahuan dan hilang saat soal dimulai", () => {
    const views = hostThrough([
      hostWelcome(),
      { t: "error", code: "NOT_ALLOWED_NOW", message: "Belum ada pemain" },
      { t: "question", ...question },
    ]);
    expect(views[1]).toMatchObject({ kind: "lobby", base: { notice: "Belum ada pemain" } });
    expect(views[2]).toMatchObject({ base: { notice: null } });
  });

  it("close 4000 setelah podium tidak menimpa podium", () => {
    const [ended] = hostThrough([{ t: "podium", gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", top: [], playerCount: 0 }]);
    // Podium tanpa host_welcome sebelumnya diabaikan (belum ada info room).
    expect(ended?.kind).toBe("connecting");
    const views = hostThrough([hostWelcome(), { t: "podium", gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", top: [], playerCount: 0 }]);
    const last = views.at(-1);
    if (!last) throw new Error("tidak ada tampilan");
    expect(hostScreen(last, { type: "closed", code: CloseCode.ROOM_CLOSED }).kind).toBe("ended");
  });

  it("applyRosterMessage: pemain yang sama tidak pernah ganda", () => {
    const once = applyRosterMessage([andi], { t: "player_joined", player: budi, playerCount: 2 });
    expect(applyRosterMessage(once, { t: "player_joined", player: budi, playerCount: 2 })).toEqual([andi, budi]);
  });
});

describe("hitung mundur", () => {
  it.each([
    [0, 20_000],
    [5_000, 15_000],
    [20_000, 0],
    [25_000, 0],
  ])("%i ms setelah soal diterima -> sisa %i ms", (elapsed, remaining) => {
    expect(remainingMs(1000, 20_000, 1000 + elapsed)).toBe(remaining);
  });
});
