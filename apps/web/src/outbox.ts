import { z } from "zod";
import { ChoiceIndex, ElapsedMs, QuestionIndex, type Pin, type PlayerSnapshot } from "@sorak/shared";

/**
 * Antrean jawaban (pola outbox): jawaban yang ditekan disimpan dulu, dikirim kalau tersambung, dan baru dibuang
 * setelah ada bukti diterima (answer_received). Disalin ke localStorage supaya selamat kalau halaman dimuat ulang.
 * Satu jawaban saja: jawaban baru selalu untuk soal yang lebih baru.
 */

export const QueuedAnswer = z.object({ q: QuestionIndex, choice: ChoiceIndex, elapsedMs: ElapsedMs });
export type QueuedAnswer = z.infer<typeof QueuedAnswer>;

const key = (pin: Pin) => `sorak:answer:${pin}`;

/**
 * Setelah tersambung lagi: kirim ulang hanya kalau soalnya masih aktif dan server belum punya jawabannya.
 * Kirim ulang aman karena server idempotent (jawaban dobel tetap dihitung satu).
 */
export function decideQueuedAnswer(snapshot: PlayerSnapshot, queued: QueuedAnswer): "resend" | "drop" {
  const live = snapshot.phase === "question" || snapshot.phase === "grace";
  if (live && snapshot.question?.q === queued.q && !snapshot.answered) return "resend";
  return "drop";
}

// localStorage bisa dilempar (mode privat, penyimpanan diblokir). Antrean tetap hidup di memori sesi;
// yang hilang hanya ketahanan saat halaman dimuat ulang.
export function loadQueuedAnswer(pin: Pin): QueuedAnswer | null {
  try {
    const raw = localStorage.getItem(key(pin));
    if (raw === null) return null;
    const parsed = QueuedAnswer.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveQueuedAnswer(pin: Pin, answer: QueuedAnswer): void {
  try {
    localStorage.setItem(key(pin), JSON.stringify(answer));
  } catch {
    return;
  }
}

export function clearQueuedAnswer(pin: Pin): void {
  try {
    localStorage.removeItem(key(pin));
  } catch {
    return;
  }
}
