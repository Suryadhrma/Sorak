import { ACCURATE_POINTS, CLASSIC_MAX_POINTS } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { scoreAnswer, type AnswerScoreInput } from "../src/scoring.ts";

const T = 20_000;
const answer = (patch: Partial<AnswerScoreInput> = {}): AnswerScoreInput => ({
  mode: "classic",
  correct: true,
  tMs: 0,
  timeLimitMs: T,
  previousStreak: 0,
  ...patch,
});

describe("scoreAnswer Klasik", () => {
  it.each([
    ["t = 0", 0, 1000],
    ["t = T/2", T / 2, 750],
    ["t = T", T, 500],
    ["t > T dibatasi ke T", T + 5000, 500],
    ["t negatif dibatasi ke 0", -100, 1000],
  ])("%s -> %i poin", (_label, tMs, points) => {
    expect(scoreAnswer(answer({ tMs }))).toEqual({ points, streak: 1 });
  });

  it("salah atau tidak menjawab: 0 poin dan kombo putus", () => {
    expect(scoreAnswer(answer({ correct: false, previousStreak: 4 }))).toEqual({ points: 0, streak: 0 });
  });
});

describe("kombo", () => {
  it("7 jawaban benar beruntun: bonus 0, 50, 100, 150, 200, 250, 250", () => {
    let streak = 0;
    const bonuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const result = scoreAnswer(answer({ previousStreak: streak }));
      bonuses.push(result.points - CLASSIC_MAX_POINTS);
      streak = result.streak;
    }
    expect(bonuses).toEqual([0, 50, 100, 150, 200, 250, 250]);
  });

  it("jawaban salah di tengah deret me-reset kombo", () => {
    const sequence = [true, true, true, false, true];
    let streak = 0;
    const points: number[] = [];
    for (const correct of sequence) {
      const result = scoreAnswer(answer({ correct, previousStreak: streak }));
      points.push(result.points);
      streak = result.streak;
    }
    expect(points).toEqual([1000, 1050, 1100, 0, 1000]);
  });
});

describe("scoreAnswer Akurat", () => {
  it.each([0, T / 2, T])("tidak dipengaruhi waktu (t = %i)", (tMs) => {
    expect(scoreAnswer(answer({ mode: "accurate", tMs })).points).toBe(ACCURATE_POINTS);
  });

  it("kombo tetap berlaku", () => {
    expect(scoreAnswer(answer({ mode: "accurate", previousStreak: 2 }))).toEqual({ points: 1100, streak: 3 });
  });
});
