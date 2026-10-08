import type { Phase } from "@sorak/shared";

/**
 * Siklus hidup room sebagai data (state machine), seperti ALLOWED_PHASES untuk pesan klien:
 * aturannya mudah dibaca, diuji per baris, dan GameRoom tidak menyimpan if-else tahap sendiri.
 */

export type PhaseEvent =
  | "start"
  | "deadline"
  | "all_answered"
  | "grace_over"
  /** Host menekan Lanjut dan masih ada soal. */
  | "next"
  /** Host menekan Lanjut di soal terakhir. */
  | "next_last"
  | "idle_timeout"
  | "end"
  | "retention_over";

/** "cancelled" = lobby dibatalkan, "closed" = room selesai dibersihkan. Keduanya menutup semua socket. */
export type PhaseTarget = Phase | "cancelled" | "closed";

const TRANSITIONS: Record<Phase, Partial<Record<PhaseEvent, PhaseTarget>>> = {
  // idle_timeout di lobby: tidak ada layar host selama LOBBY_IDLE_TIMEOUT_MS (Hari 2).
  lobby: { start: "question", end: "cancelled", idle_timeout: "cancelled" },
  question: { deadline: "grace", all_answered: "grace", end: "ended" },
  grace: { grace_over: "reveal", end: "ended" },
  reveal: { next: "question", next_last: "ended", idle_timeout: "ended", end: "ended" },
  ended: { retention_over: "closed" },
};

/** Tahap berikutnya, atau null kalau event itu tidak sah di tahap ini (GameRoom mencatatnya dan tidak mengubah apa pun). */
export function nextPhase(phase: Phase, event: PhaseEvent): PhaseTarget | null {
  return TRANSITIONS[phase][event] ?? null;
}
