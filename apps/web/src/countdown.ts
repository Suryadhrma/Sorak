import { COUNTDOWN_URGENT_SEC } from "@sorak/shared";

/**
 * Sisa waktu soal dari jam monoton (performance.now) sejak pesan soal diterima, bukan jam HP:
 * jam HP bisa salah beberapa menit, sedangkan selisih performance.now tidak terpengaruh.
 */
export function remainingMs(startedAt: number, durationMs: number, now: number): number {
  return Math.max(0, durationMs - (now - startedAt));
}

export type CountdownDisplay = { seconds: number; fraction: number; urgent: boolean };

/** Angka detik (dibulatkan ke atas), sisa porsi batang waktu (0..1), dan apakah sudah di detik-detik kritis. */
export function countdownDisplay(remaining: number, durationMs: number): CountdownDisplay {
  const seconds = Math.ceil(Math.max(0, remaining) / 1000);
  const fraction = durationMs <= 0 ? 0 : Math.min(1, Math.max(0, remaining) / durationMs);
  return { seconds, fraction, urgent: seconds <= COUNTDOWN_URGENT_SEC };
}
