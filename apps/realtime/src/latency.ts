import { LATENCY_EPSILON_MS, LATENCY_EWMA_ALPHA, MAX_ONE_WAY_LATENCY_MS } from "@sorak/shared";

/**
 * Estimasi jeda satu arah HP dengan EWMA (rata-rata bergerak berbobot): sampel baru hanya mengubah
 * LATENCY_EWMA_ALPHA (30%) estimasi. Satu lonjakan sesaat tidak merusak estimasi, tapi sinyal yang memang
 * memburuk ikut terbaca dalam beberapa soal. Jeda satu arah diperkirakan setengah RTT (pulang-pergi).
 */
export function updateLatency(previousMs: number | null, rttMs: number): number {
  // RTT dihitung dari jam server saja, jadi negatif berarti bug di pemanggil.
  if (rttMs < 0) throw new Error(`RTT negatif: ${rttMs}`);
  const sample = Math.min(rttMs / 2, MAX_ONE_WAY_LATENCY_MS);
  if (previousMs === null) return Math.round(sample);
  const smoothed = Math.round((1 - LATENCY_EWMA_ALPHA) * previousMs + LATENCY_EWMA_ALPHA * sample);
  return Math.min(smoothed, MAX_ONE_WAY_LATENCY_MS);
}

/**
 * Waktu jawab yang dinilai, dengan prinsip "trust but verify": klaim elapsedMs dari HP dipakai hanya kalau
 * masuk akal secara fisik.
 * - Batas atas tServer: HP tidak mungkin berpikir lebih lama dari jeda soal-dikirim sampai jawaban-tiba.
 * - Batas bawah tServer - 2d - epsilon: soal butuh d untuk sampai dan jawaban butuh d untuk kembali, jadi klaim
 *   yang lebih cepat dari itu dipotong.
 * Pemain yang belum pernah ack (latency null) diperlakukan d = 0: tanpa kelonggaran tambahan.
 */
export function compensateAnswerTime(input: {
  elapsedMs: number;
  tServerMs: number;
  latencyMs: number | null;
  timeLimitMs: number;
}): number {
  const d = input.latencyMs ?? 0;
  const lower = Math.max(0, input.tServerMs - 2 * d - LATENCY_EPSILON_MS);
  const clamped = Math.min(Math.max(input.elapsedMs, lower), input.tServerMs);
  return Math.max(0, Math.min(clamped, input.timeLimitMs));
}
