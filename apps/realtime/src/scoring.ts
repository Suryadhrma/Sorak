import {
  ACCURATE_POINTS,
  CLASSIC_MAX_POINTS,
  CLASSIC_MIN_FACTOR,
  COMBO_MAX_POINTS,
  COMBO_STEP_POINTS,
  type ScoringMode,
} from "@sorak/shared";

/** Taruhan Yakin (confidence) dinilai mulai Hari 7. */
export type ScoredMode = Exclude<ScoringMode, "confidence">;

export type AnswerScoreInput = {
  mode: ScoredMode;
  correct: boolean;
  /** Waktu jawab yang sudah ditetapkan server; dibatasi ke 0..timeLimitMs di sini. */
  tMs: number;
  timeLimitMs: number;
  previousStreak: number;
};

/**
 * Poin satu jawaban. Salah atau tidak menjawab: 0 poin dan kombo putus.
 * Benar: poin dasar (Klasik turun linear dari 1000 ke 500 sesuai waktu; Akurat selalu 1000)
 * ditambah bonus kombo yang naik 50 per jawaban benar beruntun, paling banyak 250.
 */
export function scoreAnswer(input: AnswerScoreInput): { points: number; streak: number } {
  if (!input.correct) return { points: 0, streak: 0 };

  const streak = input.previousStreak + 1;
  const combo = Math.min(COMBO_STEP_POINTS * (streak - 1), COMBO_MAX_POINTS);
  return { points: basePoints(input) + combo, streak };
}

function basePoints({ mode, tMs, timeLimitMs }: AnswerScoreInput): number {
  if (mode === "accurate") return ACCURATE_POINTS;
  const t = Math.min(Math.max(tMs, 0), timeLimitMs);
  return Math.round(CLASSIC_MAX_POINTS * (1 - (CLASSIC_MIN_FACTOR * t) / timeLimitMs));
}
