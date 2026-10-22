/** Baris daftar guru muncul berurutan; urutannya dibatasi supaya daftar panjang tidak lama menunggu baris bawahnya. */
export const MAX_ROW_ORDER = 8;

export function rowOrder(index: number): number {
  return Math.min(index, MAX_ROW_ORDER);
}
