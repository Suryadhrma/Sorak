import { STALE_SOCKET_MS } from "@sorak/shared";

/**
 * Socket pemain dianggap mati kalau tidak ada tanda hidup selama STALE_SOCKET_MS.
 * Tanda hidup terakhir = pong terbaru, atau saat join kalau belum pernah ping,
 * supaya pemain yang baru masuk tidak langsung dianggap basi.
 */
export function isStale(now: number, lastPongAt: number | null, joinedAt: number): boolean {
  const lastSeenAt = Math.max(lastPongAt ?? 0, joinedAt);
  return now - lastSeenAt > STALE_SOCKET_MS;
}
