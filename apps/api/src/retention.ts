import { GAME_RESULT_RETENTION_DAYS, RETENTION_DELETE_BATCH, RETENTION_MAX_ROUNDS } from "@sorak/shared";
import { log } from "./log.ts";

/**
 * Cron retensi: hasil game yang lebih tua dari GAME_RESULT_RETENTION_DAYS dihapus bertahap. game_players dan
 * game_question_stats ikut terhapus lewat ON DELETE CASCADE.
 */

export type RetentionResult = { deleted: number; rowsWritten: number; backlog: boolean };

const DAY_MS = 86_400_000;

// Sedikit demi sedikit lewat indeks games_ended_idx: satu DELETE besar bisa melewati batas CPU dan menulis
// ribuan baris sekaligus. RETURNING id karena meta.changes di D1 ikut menghitung baris anak yang terhapus
// lewat CASCADE, jadi tidak bisa dipakai untuk menghitung jumlah game.
// Diekspor supaya test EXPLAIN QUERY PLAN memeriksa query yang sama persis.
export const DELETE_EXPIRED_SQL = "DELETE FROM games WHERE id IN (SELECT id FROM games WHERE ended_at < ? LIMIT ?) RETURNING id";

export async function deleteExpiredGames(db: D1Database, now: number): Promise<RetentionResult> {
  const cutoff = now - GAME_RESULT_RETENTION_DAYS * DAY_MS;
  let deleted = 0;
  let rowsWritten = 0;
  let lastBatchFull = false;
  for (let round = 0; round < RETENTION_MAX_ROUNDS; round++) {
    const result = await db.prepare(DELETE_EXPIRED_SQL).bind(cutoff, RETENTION_DELETE_BATCH).all();
    deleted += result.results.length;
    rowsWritten += result.meta.rows_written;
    lastBatchFull = result.results.length === RETENTION_DELETE_BATCH;
    // Kurang dari satu putaran penuh: tidak ada lagi yang kedaluwarsa.
    if (!lastBatchFull) break;
  }
  log.info("retention_cleanup", { deleted, rowsWritten });
  // Putaran habis dan putaran terakhir penuh: mungkin masih ada sisa. Cron besok melanjutkan.
  if (lastBatchFull) log.info("retention_backlog", { deleted, rounds: RETENTION_MAX_ROUNDS });
  return { deleted, rowsWritten, backlog: lastBatchFull };
}
