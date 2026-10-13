import {
  GAME_EVENT_MAX_BYTES,
  GAME_EVENT_RETRY_MS,
  GAME_EVENT_TRUNCATED_OPTION_LENGTH,
  GAME_EVENT_TRUNCATED_PROMPT_LENGTH,
  GameEndedEvent,
  MAX_PLAYERS_PER_ROOM,
  MAX_QUESTIONS_PER_QUIZ,
  NICKNAME_MAX_LENGTH,
  OPTION_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
  QUIZ_TITLE_MAX_LENGTH,
  type PlayerScore,
  type QuestionStats,
  type Roster,
  type StoredQuestion,
} from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { buildGameEndedEvent, fitGameEvent, gameEventRetryDelay, truncateText, type GameEventInput } from "../src/game-event.ts";
import { emptyScore } from "../src/reveal.ts";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
/** Teks yang tidak berubah setelah bolak-balik UTF-8: tidak ada surrogate yatim (emoji terbelah). */
const wellFormed = (text: string) => new TextDecoder().decode(new TextEncoder().encode(text)) === text;

const question = (i: number, text = `Soal ${i + 1}?`, option = "pilihan"): StoredQuestion => ({
  questionId: `q${i}`,
  prompt: text,
  options: [`${option} A`, `${option} B`, `${option} C`, `${option} D`].map((value) => value.slice(0, OPTION_MAX_LENGTH)),
  correctIndex: 1,
  timeLimitSec: 20,
  imageUrl: null,
});
const player = (playerId: string, nickname: string) => ({ playerId, nickname, tokenHash: "f".repeat(64), teamSize: null });
const score = (patch: Partial<PlayerScore>): PlayerScore => ({ ...emptyScore(), ...patch });
const stats = (patch: Partial<QuestionStats> = {}): QuestionStats => ({
  answerCounts: [0, 2, 1, 0],
  answered: 3,
  correct: 2,
  totalCorrectMs: 9001,
  confidentWrong: 0,
  ...patch,
});

function input(patch: Partial<GameEventInput> = {}): GameEventInput {
  const roster: Roster = [player("a", "Andi"), player("b", "Budi")];
  return {
    state: {
      gameId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      hostId: "host-1",
      pin: "482913",
      scoringMode: "classic",
      teamMode: false,
      phase: "ended",
      questionIndex: 1,
      questionSentAt: 1_000,
      deadlineAt: null,
      createdAt: 0,
      startedAt: 500,
      endedAt: 9_000,
      gameEventSentAt: null,
      gameEventAttempts: 0,
    },
    quiz: { quizId: "quiz-1", title: "Tata Surya", questions: [0, 1, 2, 3, 4].map((i) => question(i)) },
    roster,
    scoreboard: {
      a: score({ score: 1800, correct: 2, answered: 2, bestStreak: 2, fastestCorrectMs: 1200 }),
      b: score({ score: 900, correct: 1, answered: 2, bestStreak: 1 }),
    },
    qstats: [stats(), stats({ answerCounts: [1, 1, 1, 0], correct: 1, totalCorrectMs: 4000 })],
    ...patch,
  };
}

describe("buildGameEndedEvent", () => {
  it("pemain dari roster (yang di-kick tidak ikut), peringkat sama dengan reveal, highlights dari scoreboard", () => {
    // Cici sudah di-kick: tidak ada di roster, walaupun skornya masih tertinggal di scoreboard.
    const base = input();
    const event = buildGameEndedEvent({ ...base, scoreboard: { ...base.scoreboard, c: score({ score: 5000 }) } });
    expect(GameEndedEvent.safeParse(event).success).toBe(true);
    expect(event.players).toEqual([
      {
        playerId: "a",
        nickname: "Andi",
        teamSize: null,
        finalScore: 1800,
        finalRank: 1,
        correctCount: 2,
        answeredCount: 2,
        highlights: { bestStreak: 2, confidentCorrect: 0, biggestRankClimb: 0, fastestCorrectMs: 1200 },
      },
      {
        playerId: "b",
        nickname: "Budi",
        teamSize: null,
        finalScore: 900,
        finalRank: 2,
        correctCount: 1,
        answeredCount: 2,
        highlights: { bestStreak: 1, confidentCorrect: 0, biggestRankClimb: 0, fastestCorrectMs: null },
      },
    ]);
    expect(event).toMatchObject({
      type: "game_ended",
      v: 1,
      gameId: base.state.gameId,
      hostId: "host-1",
      quizId: "quiz-1",
      quizTitle: "Tata Surya",
      pin: "482913",
      scoringMode: "classic",
      teamMode: false,
      startedAt: 500,
      endedAt: 9_000,
    });
  });

  it("game diakhiri setelah 2 dari 5 soal: hanya soal yang sudah di-reveal", () => {
    const event = buildGameEndedEvent(input());
    expect(event.questions).toHaveLength(2);
    expect(event.questions[1]).toEqual({
      position: 1,
      questionId: "q1",
      prompt: "Soal 2?",
      options: ["pilihan A", "pilihan B", "pilihan C", "pilihan D"],
      correctIndex: 1,
      answerCounts: [1, 1, 1, 0],
      answeredCount: 3,
      correctCount: 1,
      avgAnswerMs: 4000,
      confidentWrongCount: 0,
    });
  });

  it("avgAnswerMs = rata-rata jawaban benar saja (dibulatkan), null kalau tidak ada yang benar", () => {
    const event = buildGameEndedEvent(input({ qstats: [stats(), stats({ correct: 0, totalCorrectMs: 0 })] }));
    expect(event.questions.map((entry) => entry.avgAnswerMs)).toEqual([4501, null]);
  });

  it("pemain yang belum pernah dinilai (tidak ada di scoreboard) tercatat dengan skor 0", () => {
    const event = buildGameEndedEvent(input({ scoreboard: {} }));
    expect(event.players.map((entry) => [entry.finalScore, entry.finalRank, entry.answeredCount])).toEqual([
      [0, 1, 0],
      [0, 1, 0],
    ]);
  });
});

describe("truncateText", () => {
  it("teks yang muat tidak diubah", () => {
    expect(truncateText("Planet terbesar?", 16)).toBe("Planet terbesar?");
  });

  it("dipotong per huruf Unicode dan diakhiri …, panjang akhir tepat batasnya", () => {
    expect(truncateText("abcdefghij", 5)).toBe("abcd…");
    expect(Array.from(truncateText("ꦲ".repeat(300), 120))).toHaveLength(120);
  });

  it("emoji (dua unit UTF-16) tidak terbelah", () => {
    const cut = truncateText("😀".repeat(150), 120);
    expect(wellFormed(cut)).toBe(true);
    expect(cut).toBe(`${"😀".repeat(119)}…`);
    // Pembanding: slice biasa memotong emoji di tengah.
    expect(wellFormed("😀".repeat(150).slice(0, 119))).toBe(false);
  });
});

/** 200 pemain dan 50 soal dengan semua teks sepanjang maksimal, memakai huruf `letter`. */
function worstCase(letter: string): GameEndedEvent {
  const roster: Roster = Array.from({ length: MAX_PLAYERS_PER_ROOM }, () => ({
    ...player(crypto.randomUUID(), letter.repeat(NICKNAME_MAX_LENGTH)),
    teamSize: 10,
  }));
  const scoreboard = Object.fromEntries(
    roster.map((entry, i) => [
      entry.playerId,
      score({ score: 999_999 - i, correct: 50, answered: 50, bestStreak: 50, confidentCorrect: 50, biggestRankClimb: 199, fastestCorrectMs: 119_999 }),
    ]),
  );
  const questions = Array.from({ length: MAX_QUESTIONS_PER_QUIZ }, (_, i) => ({
    ...question(i, letter.repeat(PROMPT_MAX_LENGTH)),
    questionId: crypto.randomUUID(),
    options: Array.from({ length: 4 }, () => letter.repeat(OPTION_MAX_LENGTH)),
  }));
  const base = input();
  return buildGameEndedEvent({
    state: { ...base.state, scoringMode: "confidence", teamMode: true, startedAt: 1_790_000_000_000, endedAt: 1_790_000_900_000 },
    quiz: { quizId: crypto.randomUUID(), title: letter.repeat(QUIZ_TITLE_MAX_LENGTH), questions },
    roster,
    scoreboard,
    qstats: questions.map(() => stats({ answerCounts: [200, 200, 200, 200], answered: 200, correct: 200, totalCorrectMs: 23_999_800, confidentWrong: 200 })),
  });
}

describe("fitGameEvent (batas Queue)", () => {
  it("kasus terburuk huruf Latin terkirim utuh", () => {
    const event = worstCase("a");
    const fitted = fitGameEvent(event);
    console.info(`event terburuk Latin: ${fitted.bytes} byte (batas ${GAME_EVENT_MAX_BYTES})`);
    expect(fitted).toEqual({ kind: "whole", event, bytes: bytes(event) });
  });

  it("kasus terburuk 3 byte per huruf terkirim terpotong, lolos skema, dengan sisa ruang minimal 10%", () => {
    const event = worstCase("ꦲ");
    const fitted = fitGameEvent(event);
    if (fitted.kind !== "truncated") throw new Error(`seharusnya terpotong, didapat ${fitted.kind}`);
    console.info(`event terburuk 3 byte: ${fitted.originalBytes} byte -> ${fitted.bytes} byte setelah dipotong`);
    expect(fitted.originalBytes).toBe(bytes(event));
    expect(fitted.originalBytes).toBeGreaterThan(GAME_EVENT_MAX_BYTES);
    expect(fitted.bytes).toBe(bytes(fitted.event));
    expect(fitted.bytes).toBeLessThanOrEqual(115_000);
    expect(GameEndedEvent.safeParse(fitted.event).success).toBe(true);

    const [first] = fitted.event.questions;
    expect(Array.from(first?.prompt ?? "")).toHaveLength(GAME_EVENT_TRUNCATED_PROMPT_LENGTH);
    expect(first?.prompt.endsWith("…")).toBe(true);
    expect(first?.options.map((option) => Array.from(option).length)).toEqual(Array(4).fill(GAME_EVENT_TRUNCATED_OPTION_LENGTH));
    // Hanya teks soal dan pilihan yang dipotong; pemain dan statistik utuh.
    expect(fitted.event.players).toEqual(event.players);
    expect(fitted.event.quizTitle).toBe(event.quizTitle);
  });

  it("masih lewat batas setelah dipotong (bug: pemain jauh melebihi batas room) -> too_large, tidak ada event", () => {
    const event = worstCase("ꦲ");
    const oversized = { ...event, players: [...event.players, ...event.players, ...event.players] };
    const fitted = fitGameEvent(oversized);
    if (fitted.kind !== "too_large") throw new Error(`seharusnya too_large, didapat ${fitted.kind}`);
    expect(fitted).not.toHaveProperty("event");
    expect(fitted.bytes).toBeGreaterThan(GAME_EVENT_MAX_BYTES);
    expect(fitted.originalBytes).toBe(bytes(oversized));
  });
});

describe("gameEventRetryDelay", () => {
  it("jeda makin panjang per percobaan gagal, lalu berhenti di elemen terakhir", () => {
    const last = GAME_EVENT_RETRY_MS[GAME_EVENT_RETRY_MS.length - 1];
    expect([1, 2, 3, 4, 5, 6, 7, 40].map((failed) => gameEventRetryDelay(failed))).toEqual([...GAME_EVENT_RETRY_MS, last, last]);
  });
});
