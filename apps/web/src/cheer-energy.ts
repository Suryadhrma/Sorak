import { CHEER_ENERGY_MAX, CHEER_ENERGY_REFILL_MS } from "@sorak/shared";

/**
 * "Tenaga sorak" di HP (board HP-3): 5 garis; satu tekan memakai satu garis, terisi lagi satu setiap 0,6 detik.
 * Disimpan sebagai level pada waktu `at` (performance.now()), lalu dihitung maju; tanpa timer yang mengubah state.
 * Batas di HP ini lebih ketat dari ember sorak di server, jadi HP yang jujur tidak pernah kena buang.
 */
export type CheerEnergy = { level: number; at: number };

export function fullEnergy(now: number): CheerEnergy {
  return { level: CHEER_ENERGY_MAX, at: now };
}

export function energyLevel(energy: CheerEnergy, now: number): number {
  return Math.min(CHEER_ENERGY_MAX, energy.level + Math.max(0, now - energy.at) / CHEER_ENERGY_REFILL_MS);
}

/** Tenaga habis: tombol tetap bisa ditekan, tapi tidak mengirim apa pun (sent false). */
export function spendCheer(energy: CheerEnergy, now: number): { sent: boolean; energy: CheerEnergy } {
  const level = energyLevel(energy, now);
  if (level < 1) return { sent: false, energy: { level, at: now } };
  return { sent: true, energy: { level: level - 1, at: now } };
}
