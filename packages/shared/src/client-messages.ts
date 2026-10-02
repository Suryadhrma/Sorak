import { z } from "zod";
import { PROTOCOL_VERSION, REACTIONS } from "./constants.ts";
import {
  ChoiceIndex,
  Confidence,
  ElapsedMs,
  Nickname,
  PlayerId,
  QuestionIndex,
  SessionToken,
  TeamSize,
  type Phase,
} from "./primitives.ts";

/**
 * Pesan dari klien ke GameRoom.
 *
 * Semua memakai z.strictObject: field yang tidak dikenal membuat pesan ditolak.
 * Prinsipnya "ketat pada yang diterima": klien tidak bisa menyelipkan field
 * seperti `score` atau `isHost` berharap server ikut memakainya.
 *
 * Field `t` (type) menentukan jenis pesan. Skema digabung dengan
 * z.discriminatedUnion("t", …) sehingga Zod langsung tahu skema mana yang dipakai.
 */

const ProtocolVersion = z.literal(PROTOCOL_VERSION);

// ---------- Pemain ----------

/** Pesan pertama dari pemain baru. */
export const JoinMessage = z.strictObject({
  t: z.literal("join"),
  v: ProtocolVersion,
  nickname: Nickname,
  teamSize: TeamSize.optional(),
});

/** Pesan pertama dari pemain yang tersambung ulang. Token dikirim di pesan, bukan di URL, supaya tidak tercatat di log. */
export const ResumeMessage = z.strictObject({
  t: z.literal("resume"),
  v: ProtocolVersion,
  sessionToken: SessionToken,
});

/** "Soal sudah sampai". Sekaligus dipakai server untuk mengukur jeda sinyal (RTT). */
export const AckMessage = z.strictObject({
  t: z.literal("ack"),
  q: QuestionIndex,
});

/** Jawaban. elapsedMs = lama berpikir menurut stopwatch HP; server membatasinya ke rentang wajar. */
export const AnswerMessage = z.strictObject({
  t: z.literal("answer"),
  q: QuestionIndex,
  choice: ChoiceIndex,
  elapsedMs: ElapsedMs,
  confidence: Confidence.optional(),
});

/** Tombol Sorak (F-16). */
export const ReactMessage = z.strictObject({
  t: z.literal("react"),
  reaction: z.enum(REACTIONS),
});

export const PlayerMessage = z.discriminatedUnion("t", [
  JoinMessage,
  ResumeMessage,
  AckMessage,
  AnswerMessage,
  ReactMessage,
]);
export type PlayerMessage = z.infer<typeof PlayerMessage>;

// ---------- Host ----------

/** Pesan pertama dari layar host. Identitas host sudah dicek Worker lewat cookie. */
export const HostHelloMessage = z.strictObject({
  t: z.literal("host_hello"),
  v: ProtocolVersion,
});

export const StartMessage = z.strictObject({ t: z.literal("start") });
export const NextMessage = z.strictObject({ t: z.literal("next") });
export const KickMessage = z.strictObject({ t: z.literal("kick"), playerId: PlayerId });
/** Menghentikan game lebih awal (atau membatalkan di lobby). */
export const EndMessage = z.strictObject({ t: z.literal("end") });

export const HostMessage = z.discriminatedUnion("t", [
  HostHelloMessage,
  StartMessage,
  NextMessage,
  KickMessage,
  EndMessage,
]);
export type HostMessage = z.infer<typeof HostMessage>;

export type ClientMessage = PlayerMessage | HostMessage;
export type ClientMessageType = ClientMessage["t"];

/**
 * Pesan apa yang sah di tahap mana. GameRoom mengabaikan pesan di luar tabel ini.
 * Dengan menaruh aturan sebagai data, aturan mudah dibaca, dites, dan didokumentasikan.
 */
export const ALLOWED_PHASES: Record<ClientMessageType, readonly Phase[]> = {
  join: ["lobby"],
  resume: ["lobby", "question", "grace", "reveal", "ended"],
  ack: ["question", "grace"],
  answer: ["question", "grace"],
  react: ["lobby", "question", "grace", "reveal", "ended"],
  host_hello: ["lobby", "question", "grace", "reveal", "ended"],
  start: ["lobby"],
  next: ["reveal"],
  kick: ["lobby", "question", "grace", "reveal"],
  end: ["lobby", "question", "grace", "reveal"],
};

export function isAllowedInPhase(type: ClientMessageType, phase: Phase): boolean {
  return ALLOWED_PHASES[type].includes(phase);
}
