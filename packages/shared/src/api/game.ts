import { z } from "zod";
import { GAMES_PAGE_SIZE, MAX_PLAYERS_PER_ROOM, MAX_QUESTIONS_PER_QUIZ, QUIZ_TITLE_MAX_LENGTH } from "../constants.ts";
import { ChoiceIndex, GameId, Nickname, Options, Pin, Prompt, ScoringMode } from "../primitives.ts";

/**
 * Skema REST riwayat game (halaman Riwayat dan Laporan guru). Dipakai Worker untuk membentuk respons dan web
 * untuk memvalidasinya. playerId dan highlights tidak dikirim karena belum dipakai di halaman guru.
 */

const Timestamp = z.number().int().nonnegative();
const Count = z.number().int().min(0);

export const GameSummary = z.object({
  id: GameId,
  quizTitle: z.string().min(1).max(QUIZ_TITLE_MAX_LENGTH),
  pin: Pin,
  scoringMode: ScoringMode,
  playerCount: Count,
  questionCount: Count,
  startedAt: Timestamp,
  endedAt: Timestamp,
});
export type GameSummary = z.infer<typeof GameSummary>;

export const GameListResponse = z.object({
  games: z.array(GameSummary).max(GAMES_PAGE_SIZE),
  /** Cursor halaman berikutnya (keyset), atau null kalau ini halaman terakhir. */
  nextCursor: z.string().min(1).nullable(),
});
export type GameListResponse = z.infer<typeof GameListResponse>;

export const GamePlayerResult = z.object({
  nickname: Nickname,
  finalScore: Count,
  finalRank: z.number().int().min(1),
  correctCount: Count,
  answeredCount: Count,
});
export type GamePlayerResult = z.infer<typeof GamePlayerResult>;

export const GameQuestionResult = z.object({
  position: Count,
  prompt: Prompt,
  options: Options,
  correctIndex: ChoiceIndex,
  answerCounts: z.array(Count),
  answeredCount: Count,
  correctCount: Count,
  /** Rata-rata waktu jawaban yang benar saja (ms); null kalau tidak ada yang benar. */
  avgAnswerMs: Count.nullable(),
});
export type GameQuestionResult = z.infer<typeof GameQuestionResult>;

export const GameDetail = GameSummary.extend({
  players: z.array(GamePlayerResult).max(MAX_PLAYERS_PER_ROOM),
  questions: z.array(GameQuestionResult).max(MAX_QUESTIONS_PER_QUIZ),
});
export type GameDetail = z.infer<typeof GameDetail>;
