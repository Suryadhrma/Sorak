const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms pukul 00.00 WIB di hari WIB yang memuat `now`. Indonesia (WIB) tidak memakai jam musim panas. */
export function wibDayStart(now: number): number {
  return Math.floor((now + WIB_OFFSET_MS) / DAY_MS) * DAY_MS - WIB_OFFSET_MS;
}

// Diekspor supaya test EXPLAIN QUERY PLAN memeriksa query yang sama persis dengan yang dijalankan.
export const QUOTA_SQL = "SELECT COUNT(*) AS n FROM ai_generations WHERE host_id = ? AND created_at >= ?";

/**
 * Semua baris dihitung, termasuk yang gagal dan yang ditolak kuota: kuota melindungi jatah Groq bersama,
 * dan permintaan gagal pun sudah memakai token.
 */
export async function generationsSince(db: D1Database, hostId: string, since: number): Promise<number> {
  const row = await db.prepare(QUOTA_SQL).bind(hostId, since).first<{ n: number }>();
  return row?.n ?? 0;
}
