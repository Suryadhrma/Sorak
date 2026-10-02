import { z } from "zod";
import { LEADERBOARD_SIZE, MAX_PLAYERS_PER_ROOM, PODIUM_SIZE, PROTOCOL_VERSION, REACTIONS } from "./constants.ts";
import {
  ChoiceIndex,
  GameId,
  Nickname,
  Options,
  Phase,
  Pin,
  PlayerId,
  Prompt,
  QuestionIndex,
  ScoringMode,
  SessionToken,
  TeamSize,
} from "./primitives.ts";

/**
 * Pesan dari GameRoom ke klien.
 *
 * Berbeda dengan pesan klien, di sini dipakai z.object biasa (tidak strict):
 * kalau versi server yang lebih baru menambah field, klien versi lama
 * cukup mengabaikannya. Ini membuat server dan web bisa di-deploy terpisah.
 */

const Count = z.number().int().min(0).max(MAX_PLAYERS_PER_ROOM);
const Score = z.number().int().min(0);
const Rank = z.number().int().min(1);

export const RoomInfo = z.object({
  pin: Pin,
  scoringMode: ScoringMode,
  teamMode: z.boolean(),
  questionCount: z.number().int().min(1),
});
export type RoomInfo = z.infer<typeof RoomInfo>;

/**
 * Soal yang dikirim ke klien. Sengaja TIDAK berisi jawaban benar:
 * kunci jawaban baru dikirim di `reveal` / `result` setelah waktu habis.
 */
export const PublicQuestion = z.object({
  q: QuestionIndex,
  total: z.number().int().min(1),
  prompt: Prompt,
  options: Options,
  durationMs: z.number().int().positive(),
  imageUrl: z.url().nullable(),
});
export type PublicQuestion = z.infer<typeof PublicQuestion>;

export const RosterEntry = z.object({
  playerId: PlayerId,
  nickname: Nickname,
  teamSize: TeamSize.nullable(),
  connected: z.boolean(),
});
export type RosterEntry = z.infer<typeof RosterEntry>;

export const LeaderboardEntry = z.object({
  playerId: PlayerId,
  nickname: Nickname,
  teamSize: TeamSize.nullable(),
  score: Score,
  /** Perubahan skor di soal terakhir; bisa negatif di mode Taruhan Yakin. */
  delta: z.number().int(),
  rank: Rank,
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

/** Momen Rapor Sorak per pemain. */
export const Highlights = z.object({
  bestStreak: z.number().int().min(0),
  confidentCorrect: z.number().int().min(0),
  biggestRankClimb: z.number().int().min(0),
  fastestCorrectMs: z.number().int().min(0).nullable(),
});
export type Highlights = z.infer<typeof Highlights>;

export const ErrorCode = z.enum([
  "UNSUPPORTED_VERSION",
  "NICKNAME_INVALID",
  "NICKNAME_TAKEN",
  "NICKNAME_REJECTED",
  "ROOM_FULL",
  "GAME_ALREADY_STARTED",
  "SESSION_INVALID",
  "NOT_JOINED",
  "NOT_ALLOWED_NOW",
  "BAD_MESSAGE",
  "RATE_LIMITED",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * Keadaan lengkap dari sudut pandang satu pemain (snapshot).
 * Dikirim saat join dan saat reconnect, sehingga HP bisa langsung
 * menampilkan layar yang benar tanpa memutar ulang semua pesan yang terlewat.
 */
export const PlayerSnapshot = z.object({
  phase: Phase,
  question: PublicQuestion.nullable(),
  /** Sisa waktu soal aktif menurut server; null di luar tahap question. */
  remainingMs: z.number().int().min(0).nullable(),
  answered: z.boolean(),
  score: Score,
  streak: z.number().int().min(0),
  rank: Rank.nullable(),
  playerCount: Count,
});
export type PlayerSnapshot = z.infer<typeof PlayerSnapshot>;

// ---------- Ke pemain ----------

export const WelcomeMessage = z.object({
  t: z.literal("welcome"),
  v: z.literal(PROTOCOL_VERSION),
  playerId: PlayerId,
  nickname: Nickname,
  /** Hanya ada saat join pertama. Disimpan HP di localStorage untuk reconnect. */
  sessionToken: SessionToken.optional(),
  room: RoomInfo,
  snapshot: PlayerSnapshot,
});

/** Jumlah pemain di lobby. Pemain hanya menerima angka, bukan daftar 200 nama. */
export const LobbyMessage = z.object({
  t: z.literal("lobby"),
  playerCount: Count,
});

export const QuestionMessage = PublicQuestion.extend({ t: z.literal("question") });

/** Konfirmasi jawaban sudah diterima; HP boleh menghapus jawaban dari antrean offline. */
export const AnswerReceivedMessage = z.object({
  t: z.literal("answer_received"),
  q: QuestionIndex,
});

/** Waktu habis; HP menampilkan "menghitung jawaban" selama jendela toleransi. */
export const GraceMessage = z.object({
  t: z.literal("grace"),
  q: QuestionIndex,
  ms: z.number().int().positive(),
});

export const ResultMessage = z.object({
  t: z.literal("result"),
  q: QuestionIndex,
  outcome: z.enum(["correct", "wrong", "no_answer"]),
  correctIndex: ChoiceIndex,
  points: z.number().int(),
  score: Score,
  rank: Rank,
  streak: z.number().int().min(0),
});

export const FinalMessage = z.object({
  t: z.literal("final"),
  gameId: GameId,
  score: Score,
  rank: Rank,
  playerCount: Count,
  highlights: Highlights,
});

export const ErrorMessage = z.object({
  t: z.literal("error"),
  code: ErrorCode,
  message: z.string(),
});

export const PlayerServerMessage = z.discriminatedUnion("t", [
  WelcomeMessage,
  LobbyMessage,
  QuestionMessage,
  AnswerReceivedMessage,
  GraceMessage,
  ResultMessage,
  FinalMessage,
  ErrorMessage,
]);
export type PlayerServerMessage = z.infer<typeof PlayerServerMessage>;

// ---------- Ke layar host ----------

/** Snapshot lengkap untuk layar host, dikirim saat host tersambung atau tersambung ulang. */
export const HostWelcomeMessage = z.object({
  t: z.literal("host_welcome"),
  v: z.literal(PROTOCOL_VERSION),
  room: RoomInfo,
  phase: Phase,
  players: z.array(RosterEntry).max(MAX_PLAYERS_PER_ROOM),
  question: PublicQuestion.nullable(),
  remainingMs: z.number().int().min(0).nullable(),
  answered: Count,
});

/** Perubahan kecil (delta) di lobby, supaya host tidak menerima ulang 200 nama setiap ada yang masuk. */
export const PlayerJoinedMessage = z.object({
  t: z.literal("player_joined"),
  player: RosterEntry,
  playerCount: Count,
});

export const PlayerLeftMessage = z.object({
  t: z.literal("player_left"),
  playerId: PlayerId,
  /** true = dikeluarkan host; false = sinyal putus (bisa kembali). */
  kicked: z.boolean(),
  playerCount: Count,
});

/** Progres "sudah menjawab 27/36" di layar proyektor. */
export const AnswerCountMessage = z.object({
  t: z.literal("answer_count"),
  q: QuestionIndex,
  answered: Count,
  total: Count,
});

export const RevealMessage = z.object({
  t: z.literal("reveal"),
  q: QuestionIndex,
  correctIndex: ChoiceIndex,
  counts: z.array(z.number().int().min(0)),
  answered: Count,
  total: Count,
  leaderboard: z.array(LeaderboardEntry).max(LEADERBOARD_SIZE),
  isLastQuestion: z.boolean(),
});

export const PodiumMessage = z.object({
  t: z.literal("podium"),
  gameId: GameId,
  top: z.array(LeaderboardEntry).max(PODIUM_SIZE),
  playerCount: Count,
});

export const ReactionMessage = z.object({
  t: z.literal("reaction"),
  reaction: z.enum(REACTIONS),
});

export const HostServerMessage = z.discriminatedUnion("t", [
  HostWelcomeMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  QuestionMessage,
  AnswerCountMessage,
  GraceMessage,
  RevealMessage,
  PodiumMessage,
  ReactionMessage,
  ErrorMessage,
]);
export type HostServerMessage = z.infer<typeof HostServerMessage>;

export type ServerMessage = PlayerServerMessage | HostServerMessage;
