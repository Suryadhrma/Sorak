import { LEADERBOARD_SIZE, Scoreboard, type PendingAnswer, type Roster, type StoredQuestion } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { emptyScore, rankPlayers, revealQuestion, type RevealInput } from "../src/reveal.ts";

const question: StoredQuestion = {
  questionId: "q1",
  prompt: "Planet terbesar?",
  options: ["Mars", "Jupiter", "Venus", "Bumi"],
  correctIndex: 1,
  timeLimitSec: 20,
  imageUrl: null,
};

const player = (playerId: string, nickname: string) => ({ playerId, nickname, tokenHash: "f".repeat(64), teamSize: null });
const roster: Roster = [player("a", "Andi"), player("b", "Budi"), player("c", "Citra")];
const answer = (playerId: string, choice: number, tMs = 0, q = 0): PendingAnswer => ({ playerId, q, choice, tMs, confidence: null });

function reveal(patch: Partial<RevealInput> = {}) {
  return revealQuestion({ question, questionIndex: 0, mode: "classic", roster, scoreboard: {}, answers: [], ...patch });
}

describe("revealQuestion", () => {
  it("benar, salah, dan tidak menjawab", () => {
    const { results, stats, scoreboard } = reveal({ answers: [answer("a", 1, 0), answer("b", 2, 4000)] });
    expect(results).toEqual([
      { playerId: "a", outcome: "correct", points: 1000, score: 1000, rank: 1, streak: 1 },
      { playerId: "b", outcome: "wrong", points: 0, score: 0, rank: 2, streak: 0 },
      { playerId: "c", outcome: "no_answer", points: 0, score: 0, rank: 2, streak: 0 },
    ]);
    expect(stats).toEqual({ answerCounts: [0, 1, 1, 0], answered: 2, correct: 1, totalCorrectMs: 0, confidentWrong: 0 });
    expect(scoreboard.a).toMatchObject({ correct: 1, answered: 1, bestStreak: 1, fastestCorrectMs: 0, lastPoints: 1000 });
    expect(scoreboard.c).toMatchObject({ answered: 0, fastestCorrectMs: null });
    expect(Scoreboard.safeParse(scoreboard).success).toBe(true);
  });

  it("skor seri: peringkat sama, urutan tampil menurut nickname", () => {
    const { leaderboard } = reveal({ answers: [answer("c", 1, 0), answer("a", 1, 0)] });
    expect(leaderboard.map((entry) => [entry.nickname, entry.rank])).toEqual([
      ["Andi", 1],
      ["Citra", 1],
      ["Budi", 3],
    ]);
  });

  it("pemain yang putus (tanpa jawaban) tetap ada di scoreboard", () => {
    const first = reveal({ answers: [answer("a", 1), answer("b", 1), answer("c", 1)] });
    const second = reveal({ questionIndex: 1, scoreboard: first.scoreboard, answers: [answer("a", 1, 0, 1)] });
    expect(Object.keys(second.scoreboard).sort()).toEqual(["a", "b", "c"]);
    expect(second.scoreboard.b).toMatchObject({ score: 1000, streak: 0, answered: 1 });
  });

  it("jawaban pending ikut dihitung, duplikat attachment + pending dihitung sekali", () => {
    const fromSocket = answer("a", 1, 2000);
    const fromPending = answer("a", 1, 2000);
    const { stats, scoreboard } = reveal({ answers: [fromSocket, fromPending, answer("b", 1, 5000)] });
    expect(stats.answered).toBe(2);
    expect(stats.answerCounts[1]).toBe(2);
    expect(scoreboard.a?.answered).toBe(1);
  });

  it("jawaban untuk soal lain diabaikan", () => {
    const { stats } = reveal({ answers: [answer("a", 1, 0, 3)] });
    expect(stats.answered).toBe(0);
  });

  it("pemain yang tidak menjawab soal ini mendapat lastPoints 0, bukan poin soal sebelumnya", () => {
    const first = reveal({ answers: [answer("a", 1, 0)] });
    expect(first.scoreboard.a?.lastPoints).toBe(1000);
    const second = reveal({ questionIndex: 1, scoreboard: first.scoreboard, answers: [] });
    expect(second.scoreboard.a).toMatchObject({ lastPoints: 0, score: 1000, streak: 0 });
    expect(second.leaderboard.find((entry) => entry.playerId === "a")?.delta).toBe(0);
  });

  it("kombo berlanjut dari scoreboard sebelumnya, dan Akurat mengabaikan waktu", () => {
    const first = reveal({ mode: "accurate", answers: [answer("a", 1, 19_000)] });
    const second = reveal({ mode: "accurate", questionIndex: 1, scoreboard: first.scoreboard, answers: [answer("a", 1, 19_000, 1)] });
    expect(second.results[0]).toMatchObject({ points: 1050, score: 2050, streak: 2 });
    expect(second.scoreboard.a).toMatchObject({ bestStreak: 2, correct: 2, fastestCorrectMs: 19_000 });
  });

  it("comeback: worstRank menyimpan peringkat terburuk, biggestRankClimb lompatan terbesarnya", () => {
    const first = reveal({ answers: [answer("a", 1, 0), answer("b", 1, 2000)] });
    expect(first.scoreboard.c).toMatchObject({ worstRank: 3, biggestRankClimb: 0 });
    const second = reveal({ questionIndex: 1, scoreboard: first.scoreboard, answers: [answer("c", 1, 0, 1)] });
    const third = reveal({ questionIndex: 2, scoreboard: second.scoreboard, answers: [answer("c", 1, 0, 2)] });
    expect(third.results.find((result) => result.playerId === "c")?.rank).toBe(1);
    expect(third.scoreboard.c).toMatchObject({ worstRank: 3, biggestRankClimb: 2 });
  });

  it(`papan skor paling banyak ${LEADERBOARD_SIZE} entri, results tetap untuk semua pemain`, () => {
    const many: Roster = Array.from({ length: 15 }, (_, i) => player(`p${i}`, `Pemain ${i}`));
    const { leaderboard, results } = reveal({ roster: many });
    expect(leaderboard).toHaveLength(LEADERBOARD_SIZE);
    expect(results).toHaveLength(15);
  });
});

describe("rankPlayers", () => {
  it("competition ranking 1, 2, 2, 4", () => {
    const four: Roster = [player("a", "A"), player("b", "B"), player("c", "C"), player("d", "D")];
    const scores = { a: 3000, b: 2000, c: 2000, d: 1000 };
    const scoreboard = Object.fromEntries(Object.entries(scores).map(([id, score]) => [id, { ...emptyScore(), score }]));
    expect(rankPlayers(four, scoreboard).map((entry) => entry.rank)).toEqual([1, 2, 2, 4]);
  });
});
