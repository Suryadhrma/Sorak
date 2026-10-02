import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM, MAX_QUESTIONS_PER_QUIZ, TIME_LIMIT_MAX_SEC, TIME_LIMIT_MIN_SEC } from "./constants.ts";
import {
  ChoiceIndex,
  Confidence,
  GameId,
  Nickname,
  Options,
  Phase,
  Pin,
  PlayerId,
  Prompt,
  QuestionIndex,
  ScoringMode,
  TeamSize,
} from "./primitives.ts";
import type { PublicQuestion } from "./server-messages.ts";

/**
 * Bentuk data yang disimpan GameRoom (Durable Object).
 * Hanya dipakai di server; tidak pernah dikirim utuh ke klien.
 * Lihat dokumen System Design bagian 5 untuk alasan tiap lokasi penyimpanan.
 */

const Timestamp = z.number().int().nonnegative();
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

// ---------- Storage (buku catatan Ruang Kuis) ----------

/** Soal lengkap termasuk kunci jawaban. Hanya ada di server. */
export const StoredQuestion = z.object({
  questionId: z.string().nullable(),
  prompt: Prompt,
  options: Options,
  correctIndex: ChoiceIndex,
  timeLimitSec: z.number().int().min(TIME_LIMIT_MIN_SEC).max(TIME_LIMIT_MAX_SEC),
  imageUrl: z.url().nullable(),
});
export type StoredQuestion = z.infer<typeof StoredQuestion>;

/** Key `quiz`: ditulis sekali saat init(). */
export const QuizSnapshot = z
  .object({
    quizId: z.string().nullable(),
    title: z.string().min(1).max(120),
    questions: z.array(StoredQuestion).min(1).max(MAX_QUESTIONS_PER_QUIZ),
  })
  .refine((quiz) => quiz.questions.every((q) => q.correctIndex < q.options.length), {
    message: "correctIndex harus menunjuk opsi yang ada",
  });
export type QuizSnapshot = z.infer<typeof QuizSnapshot>;

/** Key `state`: ditulis setiap pergantian tahap. */
export const RoomState = z.object({
  gameId: GameId,
  hostId: z.string().min(1),
  pin: Pin,
  scoringMode: ScoringMode,
  teamMode: z.boolean(),
  phase: Phase,
  questionIndex: QuestionIndex.nullable(),
  /** Kapan soal aktif dikirim (jam server). */
  questionSentAt: Timestamp.nullable(),
  /** Batas waktu soal aktif. */
  deadlineAt: Timestamp.nullable(),
  createdAt: Timestamp,
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
});
export type RoomState = z.infer<typeof RoomState>;

export const StoredRosterEntry = z.object({
  playerId: PlayerId,
  nickname: Nickname,
  tokenHash: Sha256Hex,
  teamSize: TeamSize.nullable(),
});

/** Key `roster`: ditulis sekali saat host menekan Mulai. */
export const Roster = z.array(StoredRosterEntry).max(MAX_PLAYERS_PER_ROOM);
export type Roster = z.infer<typeof Roster>;

export const PlayerScore = z.object({
  score: z.number().int().min(0),
  streak: z.number().int().min(0),
  bestStreak: z.number().int().min(0),
  correct: z.number().int().min(0),
  answered: z.number().int().min(0),
  confidentCorrect: z.number().int().min(0),
  fastestCorrectMs: z.number().int().min(0).nullable(),
  /** Peringkat terburuk yang pernah dicapai, untuk menghitung "comeback terbesar". */
  worstRank: z.number().int().min(1).nullable(),
  biggestRankClimb: z.number().int().min(0),
});
export type PlayerScore = z.infer<typeof PlayerScore>;

/** Key `scoreboard`: ditulis sekali setiap REVEAL. */
export const Scoreboard = z.record(PlayerId, PlayerScore);
export type Scoreboard = z.infer<typeof Scoreboard>;

export const QuestionStats = z.object({
  answerCounts: z.array(z.number().int().min(0)),
  answered: z.number().int().min(0),
  correct: z.number().int().min(0),
  totalCorrectMs: z.number().int().min(0),
  confidentWrong: z.number().int().min(0),
});
export type QuestionStats = z.infer<typeof QuestionStats>;

/** Key `qstats`: statistik per soal, indeks array = nomor soal. */
export const QuestionStatsList = z.array(QuestionStats).max(MAX_QUESTIONS_PER_QUIZ);

/** Jawaban soal aktif milik satu pemain. tMs sudah dikompensasi latency. */
export const ActiveAnswer = z.object({
  q: QuestionIndex,
  choice: ChoiceIndex,
  tMs: z.number().int().min(0),
  confidence: Confidence.nullable(),
});
export type ActiveAnswer = z.infer<typeof ActiveAnswer>;

/** Key `pending:<playerId>:<q>`: jawaban dari socket yang putus di tengah soal. */
export const PendingAnswer = ActiveAnswer.extend({ playerId: PlayerId });
export type PendingAnswer = z.infer<typeof PendingAnswer>;

export const StorageKey = {
  quiz: "quiz",
  state: "state",
  roster: "roster",
  scoreboard: "scoreboard",
  qstats: "qstats",
  pendingPrefix: "pending:",
} as const;

export function pendingAnswerKey(playerId: string, questionIndex: number): string {
  return `${StorageKey.pendingPrefix}${playerId}:${questionIndex}`;
}

// ---------- Attachment (kantong di tiap sambungan) ----------

/** Socket yang sudah terbuka tapi belum mengirim join/resume/host_hello. */
export const PendingAttachment = z.object({
  role: z.literal("pending"),
  connectedAt: Timestamp,
});

export const HostAttachment = z.object({
  role: z.literal("host"),
  hostId: z.string().min(1),
});

export const PlayerAttachment = z.object({
  role: z.literal("player"),
  playerId: PlayerId,
  nickname: Nickname,
  tokenHash: Sha256Hex,
  teamSize: TeamSize.nullable(),
  joinedAt: Timestamp,
  /** Estimasi jeda satu arah (EWMA), null sebelum ack pertama. */
  latencyMs: z.number().int().min(0).nullable(),
  score: z.number().int().min(0),
  streak: z.number().int().min(0),
  answer: ActiveAnswer.nullable(),
});
export type PlayerAttachment = z.infer<typeof PlayerAttachment>;

export const SocketAttachment = z.discriminatedUnion("role", [PendingAttachment, HostAttachment, PlayerAttachment]);
export type SocketAttachment = z.infer<typeof SocketAttachment>;

// ---------- Helper ----------

/**
 * Satu-satunya jalan membuat soal untuk dikirim ke klien.
 * Field dipilih satu per satu (allowlist), sehingga correctIndex tidak mungkin ikut terkirim
 * walaupun nanti StoredQuestion bertambah field baru.
 */
export function toPublicQuestion(question: StoredQuestion, index: number, total: number): PublicQuestion {
  return {
    q: index,
    total,
    prompt: question.prompt,
    options: question.options,
    durationMs: question.timeLimitSec * 1000,
    imageUrl: question.imageUrl,
  };
}
