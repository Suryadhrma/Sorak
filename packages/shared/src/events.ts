import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM, MAX_QUESTIONS_PER_QUIZ } from "./constants.ts";
import { ChoiceIndex, GameId, Nickname, Options, Pin, PlayerId, Prompt, ScoringMode, TeamSize } from "./primitives.ts";
import { Highlights } from "./server-messages.ts";

/**
 * Event yang dikirim GameRoom ke Queue saat game selesai.
 * Bentuknya mengikuti tabel D1 (games, game_players, game_question_stats),
 * sehingga consumer cukup memvalidasi lalu memasukkannya dalam satu batch.
 */

export const GameEndedPlayer = z.object({
  playerId: PlayerId,
  nickname: Nickname,
  teamSize: TeamSize.nullable(),
  finalScore: z.number().int().min(0),
  finalRank: z.number().int().min(1),
  correctCount: z.number().int().min(0),
  answeredCount: z.number().int().min(0),
  highlights: Highlights,
});

export const GameEndedQuestion = z.object({
  position: z.number().int().min(0),
  questionId: z.string().nullable(),
  prompt: Prompt,
  options: Options,
  correctIndex: ChoiceIndex,
  answerCounts: z.array(z.number().int().min(0)),
  answeredCount: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  avgAnswerMs: z.number().int().min(0).nullable(),
  confidentWrongCount: z.number().int().min(0),
});

export const GameEndedEvent = z.object({
  type: z.literal("game_ended"),
  /** Versi bentuk event, terpisah dari versi protokol WebSocket. */
  v: z.literal(1),
  gameId: GameId,
  hostId: z.string().min(1),
  quizId: z.string().nullable(),
  quizTitle: z.string().min(1).max(120),
  pin: Pin,
  scoringMode: ScoringMode,
  teamMode: z.boolean(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
  players: z.array(GameEndedPlayer).max(MAX_PLAYERS_PER_ROOM),
  questions: z.array(GameEndedQuestion).min(1).max(MAX_QUESTIONS_PER_QUIZ),
});
export type GameEndedEvent = z.infer<typeof GameEndedEvent>;
