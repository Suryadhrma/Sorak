import { z } from "zod";
import {
  DISTRACTOR_MIN_SHARE,
  REPORT_RETRY_ATTEMPTS,
  REPORT_SAVING_WINDOW_MS,
  REVIEW_BELOW_PERCENT,
  type GameQuestionResult,
} from "@sorak/shared";

/**
 * Angka di laporan guru sebagai fungsi murni: diuji tanpa React, halaman hanya menampilkannya.
 */

/** Persen benar dari yang menjawab (dibulatkan), atau null kalau tidak ada yang menjawab. */
export function correctPercent(question: GameQuestionResult): number | null {
  if (question.answeredCount === 0) return null;
  return Math.round((question.correctCount / question.answeredCount) * 100);
}

/**
 * Pilihan salah dengan pemilih terbanyak, kalau dipilih minimal DISTRACTOR_MIN_SHARE dari yang menjawab.
 * Bahan awal Peta Miskonsepsi: jawaban salah yang dipilih banyak siswa biasanya menunjuk salah paham yang sama.
 * Seri: huruf yang lebih awal.
 */
export function topDistractor(question: GameQuestionResult): { index: number; count: number } | null {
  let top: { index: number; count: number } | null = null;
  for (const [index, count] of question.answerCounts.entries()) {
    if (index === question.correctIndex || count === 0) continue;
    if (!top || count > top.count) top = { index, count };
  }
  if (!top) return null;
  return top.count / question.answeredCount >= DISTRACTOR_MIN_SHARE ? top : null;
}

export function needsReview(question: GameQuestionResult): boolean {
  const percent = correctPercent(question);
  return percent !== null && percent < REVIEW_BELOW_PERCENT;
}

/**
 * Laporan yang dibuka dari podium bisa 404 karena consumer Queue belum selesai menyimpan.
 * retry: tampilkan "Laporan sedang disimpan…" lalu coba lagi; give_up: tampilkan tombol Coba lagi;
 * not_found: laporan memang tidak ada (dibuka bukan dari podium).
 */
export type ReportRetryStep = "retry" | "give_up" | "not_found";

export function reportRetryStep(input: { msSinceGameEnded: number | null; retriesDone: number }): ReportRetryStep {
  if (input.msSinceGameEnded === null) return "not_found";
  if (input.msSinceGameEnded < REPORT_SAVING_WINDOW_MS && input.retriesDone < REPORT_RETRY_ATTEMPTS) return "retry";
  return "give_up";
}

/**
 * State navigasi dari tombol "Lihat rapor kelas" di podium: kapan game selesai, menurut performance.now() halaman
 * ini (bukan jam HP). Dibaca ulang dengan skema karena history browser bisa berisi apa saja.
 */
export const PodiumNavigationState = z.object({ gameEndedAt: z.number().nonnegative() });
export type PodiumNavigationState = z.infer<typeof PodiumNavigationState>;
