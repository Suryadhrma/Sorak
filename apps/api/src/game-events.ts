import { z } from "zod";
import { D1_MAX_BOUND_PARAMETERS, GAME_EVENT_CONSUMER_RETRY_DELAY_SEC, GameEndedEvent } from "@sorak/shared";
import { log } from "./log.ts";

/**
 * Consumer Queue sorak-game-events: menyimpan hasil game ke D1. Queue menjamin pengiriman at-least-once
 * (pesan yang sama bisa datang lebih dari sekali), jadi semua insert memakai INSERT OR IGNORE dengan kunci
 * dari event: pesan dobel menghasilkan data yang sama (idempotent consumer).
 */

export type SqlStatement = { sql: string; params: (string | number | null)[] };

const GAME_PLAYER_COLUMNS = [
  "game_id",
  "player_id",
  "nickname",
  "team_size",
  "final_score",
  "final_rank",
  "correct_count",
  "answered_count",
  "highlights",
] as const;

const GAME_QUESTION_COLUMNS = [
  "game_id",
  "position",
  "question_id",
  "prompt",
  "options",
  "correct_index",
  "answer_counts",
  "answered_count",
  "correct_count",
  "avg_answer_ms",
  "confident_wrong_count",
] as const;

// quiz_id lewat subquery: kuis yang sudah dihapus (atau bukan milik host ini) menghasilkan NULL, bukan gagal
// foreign key. Riwayat tetap tersimpan, sesuai ON DELETE SET NULL.
const INSERT_GAME_SQL = `
  INSERT OR IGNORE INTO games
    (id, host_id, quiz_id, quiz_title, pin, scoring_mode, team_mode, player_count, question_count, started_at, ended_at, created_at)
  VALUES (?, ?, (SELECT id FROM quizzes WHERE id = ? AND host_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * INSERT banyak baris sekaligus. Yang disusun hanya placeholder "?" sebanyak kolom x baris (dari daftar kolom
 * tetap di atas, bukan dari input); semua nilai tetap lewat bind.
 */
function insertRowsSql(table: string, columns: readonly string[], rowCount: number): string {
  const row = `(${columns.map(() => "?").join(", ")})`;
  return `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES ${Array.from({ length: rowCount }, () => row).join(", ")}`;
}

/** Semua insert untuk satu event, dalam urutan yang dijalankan di satu db.batch (satu transaksi). */
export function planGameInsert(event: GameEndedEvent, now: number): SqlStatement[] {
  const game: SqlStatement = {
    sql: INSERT_GAME_SQL,
    params: [
      event.gameId,
      event.hostId,
      event.quizId,
      event.hostId,
      event.quizTitle,
      event.pin,
      event.scoringMode,
      event.teamMode ? 1 : 0,
      event.players.length,
      event.questions.length,
      event.startedAt,
      event.endedAt,
      now,
    ],
  };
  const players = chunkRows(event.players, GAME_PLAYER_COLUMNS.length).map((chunk) => ({
    sql: insertRowsSql("game_players", GAME_PLAYER_COLUMNS, chunk.length),
    params: chunk.flatMap((player) => [
      event.gameId,
      player.playerId,
      player.nickname,
      player.teamSize,
      player.finalScore,
      player.finalRank,
      player.correctCount,
      player.answeredCount,
      JSON.stringify(player.highlights),
    ]),
  }));
  const questions = chunkRows(event.questions, GAME_QUESTION_COLUMNS.length).map((chunk) => ({
    sql: insertRowsSql("game_question_stats", GAME_QUESTION_COLUMNS, chunk.length),
    params: chunk.flatMap((question) => [
      event.gameId,
      question.position,
      question.questionId,
      question.prompt,
      JSON.stringify(question.options),
      question.correctIndex,
      JSON.stringify(question.answerCounts),
      question.answeredCount,
      question.correctCount,
      question.avgAnswerMs,
      question.confidentWrongCount,
    ]),
  }));
  return [game, ...players, ...questions];
}

/** Baris per statement supaya parameternya tidak melewati batas D1. */
export function chunkRows<T>(rows: readonly T[], columns: number): T[][] {
  const size = Math.floor(D1_MAX_BOUND_PARAMETERS / columns);
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += size) chunks.push(rows.slice(start, start + size));
  return chunks;
}

/** Jeda percobaan ulang ke-n (attempts dimulai 1): 60, 120, 240, ... detik. */
export function consumerRetryDelaySeconds(attempts: number): number {
  return GAME_EVENT_CONSUMER_RETRY_DELAY_SEC * 2 ** (Math.max(attempts, 1) - 1);
}

/** Hanya untuk log pesan rusak: gameId ikut dicatat kalau masih terbaca. */
const MaybeGameId = z.object({ gameId: z.string() });

export async function consumeGameEvents(messages: readonly Message<unknown>[], db: D1Database, now: number): Promise<void> {
  for (const message of messages) await consumeGameEvent(message, db, now);
}

async function consumeGameEvent(message: Message<unknown>, db: D1Database, now: number): Promise<void> {
  const parsed = GameEndedEvent.safeParse(message.body);
  if (!parsed.success) {
    // Poison message: bentuknya salah, dicoba ulang pun tetap salah. Di-ack supaya tidak membuang percobaan.
    const gameId = MaybeGameId.safeParse(message.body);
    log.error("game_ended_invalid", {
      messageId: message.id,
      gameId: gameId.success ? gameId.data.gameId : null,
      issues: parsed.error.issues,
    });
    message.ack();
    return;
  }

  const event = parsed.data;
  try {
    // Host yang akunnya sudah dihapus: insert games akan gagal foreign key setiap kali dicoba.
    const host = await db.prepare("SELECT 1 FROM hosts WHERE id = ?").bind(event.hostId).first();
    if (!host) {
      log.error("game_event_host_missing", { gameId: event.gameId, hostId: event.hostId });
      message.ack();
      return;
    }
    const results = await db.batch(planGameInsert(event, now).map((statement) => db.prepare(statement.sql).bind(...statement.params)));
    const rowsWritten = results.reduce((total, result) => total + result.meta.rows_written, 0);
    log.info("game_event_saved", { gameId: event.gameId, rowsWritten });
    message.ack();
  } catch (error) {
    // Error D1 biasanya sementara: dicoba ulang dengan jeda makin panjang; setelah max_retries pindah ke DLQ.
    const delaySeconds = consumerRetryDelaySeconds(message.attempts);
    log.error("game_event_save_failed", {
      gameId: event.gameId,
      attempts: message.attempts,
      delaySeconds,
      message: error instanceof Error ? error.message : String(error),
    });
    message.retry({ delaySeconds });
  }
}
