import { z } from "zod";
import {
  GAMES_PAGE_SIZE,
  GameId,
  GamePlayerResult,
  GameQuestionResult,
  GameSummary,
  Options,
  type GameDetail,
  type GameListResponse,
} from "@sorak/shared";

/**
 * Riwayat game milik host: daftar dengan keyset pagination dan laporan satu game.
 * Semua query memfilter host_id milik host yang login; game host lain diperlakukan seperti tidak ada.
 */

/** Posisi terakhir di halaman sebelumnya: game berikutnya selesai lebih awal (atau sama, dengan id lebih kecil). */
export type GameCursor = { endedAt: number; id: string };

const SUMMARY_COLUMNS = "id, quiz_title, pin, scoring_mode, player_count, question_count, started_at, ended_at";

// Diekspor supaya test EXPLAIN QUERY PLAN memeriksa query yang sama persis. LIMIT diisi ukuran halaman + 1:
// baris tambahan menandakan masih ada halaman berikutnya tanpa query COUNT.
export const LIST_GAMES_SQL = `
  SELECT ${SUMMARY_COLUMNS} FROM games
  WHERE host_id = ?
  ORDER BY ended_at DESC, id DESC
  LIMIT ?`;

// Keyset: lanjut tepat setelah game terakhir halaman sebelumnya. id memecah seri waktu selesai yang sama.
export const LIST_GAMES_AFTER_SQL = `
  SELECT ${SUMMARY_COLUMNS} FROM games
  WHERE host_id = ? AND (ended_at, id) < (?, ?)
  ORDER BY ended_at DESC, id DESC
  LIMIT ?`;

const GAME_OF_HOST_SQL = `SELECT ${SUMMARY_COLUMNS} FROM games WHERE id = ? AND host_id = ?`;

// Baris anak lewat subquery milik host: game host lain menghasilkan daftar kosong, bukan data orang lain.
const PLAYERS_OF_GAME_SQL = `
  SELECT nickname, final_score, final_rank, correct_count, answered_count
  FROM game_players
  WHERE game_id = (SELECT id FROM games WHERE id = ? AND host_id = ?)
  ORDER BY final_rank, nickname`;

const QUESTIONS_OF_GAME_SQL = `
  SELECT position, prompt, options, correct_index, answer_counts, answered_count, correct_count, avg_answer_ms
  FROM game_question_stats
  WHERE game_id = (SELECT id FROM games WHERE id = ? AND host_id = ?)
  ORDER BY position`;

// Kolom snake_case D1 dipetakan ke skema shared di satu tempat per tabel.
const GameSummaryRow = z
  .object({
    id: z.string(),
    quiz_title: z.string(),
    pin: z.string(),
    scoring_mode: z.string(),
    player_count: z.number(),
    question_count: z.number(),
    started_at: z.number(),
    ended_at: z.number(),
  })
  .transform((row) => ({
    id: row.id,
    quizTitle: row.quiz_title,
    pin: row.pin,
    scoringMode: row.scoring_mode,
    playerCount: row.player_count,
    questionCount: row.question_count,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }))
  .pipe(GameSummary);

const GamePlayerRow = z
  .object({
    nickname: z.string(),
    final_score: z.number(),
    final_rank: z.number(),
    correct_count: z.number(),
    answered_count: z.number(),
  })
  .transform((row) => ({
    nickname: row.nickname,
    finalScore: row.final_score,
    finalRank: row.final_rank,
    correctCount: row.correct_count,
    answeredCount: row.answered_count,
  }))
  .pipe(GamePlayerResult);

// Kolom JSON di D1; CHECK json_valid menjamin bisa di-parse, skema shared memastikan isinya.
const jsonColumn = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((text): unknown => JSON.parse(text))
    .pipe(schema);

const GameQuestionRow = z
  .object({
    position: z.number(),
    prompt: z.string(),
    options: jsonColumn(Options),
    correct_index: z.number(),
    answer_counts: jsonColumn(z.array(z.number().int().min(0))),
    answered_count: z.number(),
    correct_count: z.number(),
    avg_answer_ms: z.number().nullable(),
  })
  .transform((row) => ({
    position: row.position,
    prompt: row.prompt,
    options: row.options,
    correctIndex: row.correct_index,
    answerCounts: row.answer_counts,
    answeredCount: row.answered_count,
    correctCount: row.correct_count,
    avgAnswerMs: row.avg_answer_ms,
  }))
  .pipe(GameQuestionResult);

const CursorPayload = z.object({ endedAt: z.number().int().nonnegative(), id: GameId });

/** JSON dalam base64url: aman ditaruh di query string tanpa di-escape. Isinya hanya angka dan UUID (ASCII). */
export function encodeGameCursor(cursor: GameCursor): string {
  return btoa(JSON.stringify(CursorPayload.parse(cursor))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Null kalau cursor rusak atau dibuat-buat; route menjawab 400. */
export function decodeGameCursor(raw: string): GameCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
  } catch (error) {
    // atob menolak panjang base64 yang mustahil, JSON.parse menolak isi yang bukan JSON: keduanya cursor rusak.
    if (error instanceof SyntaxError || (error instanceof DOMException && error.name === "InvalidCharacterError")) return null;
    throw error;
  }
  const cursor = CursorPayload.safeParse(payload);
  return cursor.success ? cursor.data : null;
}

export async function listGames(db: D1Database, hostId: string, cursor: GameCursor | null): Promise<GameListResponse> {
  const limit = GAMES_PAGE_SIZE + 1;
  const statement = cursor
    ? db.prepare(LIST_GAMES_AFTER_SQL).bind(hostId, cursor.endedAt, cursor.id, limit)
    : db.prepare(LIST_GAMES_SQL).bind(hostId, limit);
  const rows = (await statement.all()).results.map((row) => GameSummaryRow.parse(row));
  const games = rows.slice(0, GAMES_PAGE_SIZE);
  const last = games.at(-1);
  const nextCursor = rows.length > GAMES_PAGE_SIZE && last ? encodeGameCursor({ endedAt: last.endedAt, id: last.id }) : null;
  return { games, nextCursor };
}

/** Null kalau game tidak ada atau milik host lain. */
export async function findGame(db: D1Database, hostId: string, gameId: string): Promise<GameDetail | null> {
  const [gameResult, playerResult, questionResult] = await db.batch([
    db.prepare(GAME_OF_HOST_SQL).bind(gameId, hostId),
    db.prepare(PLAYERS_OF_GAME_SQL).bind(gameId, hostId),
    db.prepare(QUESTIONS_OF_GAME_SQL).bind(gameId, hostId),
  ]);
  const gameRow = gameResult?.results[0];
  if (!gameRow) return null;
  return {
    ...GameSummaryRow.parse(gameRow),
    players: (playerResult?.results ?? []).map((row) => GamePlayerRow.parse(row)),
    questions: (questionResult?.results ?? []).map((row) => GameQuestionRow.parse(row)),
  };
}
