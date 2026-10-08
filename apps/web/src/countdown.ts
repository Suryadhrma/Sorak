/**
 * Sisa waktu soal dari jam monoton (performance.now) sejak pesan soal diterima, bukan jam HP:
 * jam HP bisa salah beberapa menit, sedangkan selisih performance.now tidak terpengaruh.
 */
export function remainingMs(startedAt: number, durationMs: number, now: number): number {
  return Math.max(0, durationMs - (now - startedAt));
}
