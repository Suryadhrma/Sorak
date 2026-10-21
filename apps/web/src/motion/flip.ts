import type { LeaderboardEntry } from "@sorak/shared";

/**
 * FLIP papan skor sebagai fungsi murni: untuk setiap baris di urutan baru, berapa baris ia harus digeser dari
 * posisi lamanya. Komponen mengalikannya dengan tinggi satu baris yang diukur di layar.
 */

export type LeaderboardMove = {
  playerId: string;
  /** Posisi lama dikurangi posisi baru, dalam baris. Positif: naik (mulai dari bawah). */
  shiftRows: number;
  /** Naik peringkat, termasuk yang baru masuk dari luar 10 besar: diberi bingkai kapur. */
  rose: boolean;
};

/** previous null: reveal pertama, belum ada urutan lama. Pemain baru di daftar masuk dari bawah daftar. */
export function leaderboardMoves(previous: readonly LeaderboardEntry[] | null, next: readonly LeaderboardEntry[]): LeaderboardMove[] {
  if (previous === null) return next.map((entry) => ({ playerId: entry.playerId, shiftRows: 0, rose: false }));
  const oldIndex = new Map(previous.map((entry, index) => [entry.playerId, index]));
  return next.map((entry, index) => {
    const from = oldIndex.get(entry.playerId) ?? next.length;
    const shiftRows = from - index;
    return { playerId: entry.playerId, shiftRows, rose: shiftRows > 0 };
  });
}
