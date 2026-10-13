import { env } from "cloudflare:workers";
import {
  D1_MAX_BOUND_PARAMETERS,
  D1_MAX_QUERIES_PER_INVOCATION,
  GAME_EVENT_CONSUMER_RETRY_DELAY_SEC,
  MAX_PLAYERS_PER_ROOM,
  MAX_QUESTIONS_PER_QUIZ,
} from "@sorak/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkRows, consumeGameEvents, consumerRetryDelaySeconds, planGameInsert } from "../src/game-events.ts";
import { log } from "../src/log.ts";
import { consume, gameEvent, storedRows } from "./games.ts";
import { insertHost } from "./http.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function newHost(): Promise<string> {
  const id = crypto.randomUUID();
  await insertHost({ id, email: `${id}@example.com` });
  return id;
}

describe("rencana insert (murni)", () => {
  it("chunkRows: baris per statement = floor(100 / kolom)", () => {
    const rows = Array.from({ length: 23 }, (_, i) => i);
    expect(chunkRows(rows, 9).map((chunk) => chunk.length)).toEqual([11, 11, 1]);
    expect(chunkRows(rows, 11).map((chunk) => chunk.length)).toEqual([9, 9, 5]);
    expect(chunkRows([], 9)).toEqual([]);
  });

  it(`event terbesar (${MAX_PLAYERS_PER_ROOM} pemain, ${MAX_QUESTIONS_PER_QUIZ} soal): query dan parameter di bawah batas D1`, () => {
    const statements = planGameInsert(gameEvent("host-1", { players: MAX_PLAYERS_PER_ROOM, questions: MAX_QUESTIONS_PER_QUIZ }), 0);
    // +1 untuk cek host sebelum batch.
    const queries = statements.length + 1;
    console.info(`query per event terbesar: ${queries} (batas ${D1_MAX_QUERIES_PER_INVOCATION})`);
    expect(queries).toBe(27);
    expect(queries).toBeLessThanOrEqual(D1_MAX_QUERIES_PER_INVOCATION);
    for (const statement of statements) {
      expect(statement.params.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
      expect(statement.params.length).toBe(statement.sql.split("?").length - 1);
    }
  });

  it("jeda retry consumer digandakan per percobaan", () => {
    expect([1, 2, 3, 4, 5].map((attempts) => consumerRetryDelaySeconds(attempts))).toEqual([60, 120, 240, 480, 960]);
  });

  it("konfigurasi consumer di wrangler.jsonc sesuai rancangan", () => {
    expect(env.TEST_GAME_EVENTS_CONSUMER).toMatchObject({
      max_batch_size: 1,
      max_retries: 5,
      retry_delay: GAME_EVENT_CONSUMER_RETRY_DELAY_SEC,
      dead_letter_queue: "sorak-game-events-dlq",
    });
  });
});

describe("consumer sorak-game-events", () => {
  it("event valid -> 1 baris games, N baris game_players, M baris game_question_stats, lalu ack", async () => {
    const hostId = await newHost();
    const quizId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO quizzes (id, host_id, title, created_at, updated_at) VALUES (?, ?, 'Kuis IPA', 0, 0)").bind(quizId, hostId).run();
    const event = { ...gameEvent(hostId, { players: 3, questions: 2 }), quizId };

    const result = await consume(event);
    expect(result.explicitAcks).toEqual(["m1"]);
    expect(result.retryMessages).toEqual([]);
    expect(await storedRows(event.gameId)).toEqual({ games: 1, players: 3, stats: 2 });

    const game = await env.DB.prepare("SELECT quiz_id, player_count, question_count, team_mode FROM games WHERE id = ?").bind(event.gameId).first();
    expect(game).toEqual({ quiz_id: quizId, player_count: 3, question_count: 2, team_mode: 0 });
    const stats = await env.DB.prepare("SELECT options, answer_counts, avg_answer_ms FROM game_question_stats WHERE game_id = ? AND position = 1")
      .bind(event.gameId)
      .first();
    expect(stats).toEqual({ options: JSON.stringify(["Mars", "Jupiter", "Venus", "Bumi"]), answer_counts: "[1,2,0,0]", avg_answer_ms: 4200 });
  });

  it("pesan yang sama datang dua kali (at-least-once) -> jumlah baris tetap, kiriman kedua tidak menulis apa pun", async () => {
    const info = vi.spyOn(log, "info");
    const event = gameEvent(await newHost());
    await consume(event);
    const second = await consume(event);
    expect(second.explicitAcks).toEqual(["m1"]);
    expect(await storedRows(event.gameId)).toEqual({ games: 1, players: 3, stats: 2 });
    const saved = info.mock.calls.filter(([name]) => name === "game_event_saved").map(([, fields]) => fields?.rowsWritten);
    expect(saved).toEqual([4 + 3 + 2, 0]);
  });

  it("kuis sudah dihapus -> quiz_id NULL, data lain tersimpan", async () => {
    const event = { ...gameEvent(await newHost()), quizId: crypto.randomUUID() };
    await consume(event);
    const game = await env.DB.prepare("SELECT quiz_id, quiz_title FROM games WHERE id = ?").bind(event.gameId).first();
    expect(game).toEqual({ quiz_id: null, quiz_title: "Kuis IPA" });
    expect(await storedRows(event.gameId)).toEqual({ games: 1, players: 3, stats: 2 });
  });

  it("kuis milik host lain -> quiz_id NULL (tidak menautkan kuis orang lain)", async () => {
    const owner = await newHost();
    const quizId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO quizzes (id, host_id, title, created_at, updated_at) VALUES (?, ?, 'Milik orang', 0, 0)").bind(quizId, owner).run();
    const event = { ...gameEvent(await newHost()), quizId };
    await consume(event);
    expect(await env.DB.prepare("SELECT quiz_id FROM games WHERE id = ?").bind(event.gameId).first()).toEqual({ quiz_id: null });
  });

  it("host sudah tidak ada -> ack tanpa insert", async () => {
    const error = vi.spyOn(log, "error");
    const event = gameEvent(crypto.randomUUID());
    const result = await consume(event);
    expect(result.explicitAcks).toEqual(["m1"]);
    expect(result.retryMessages).toEqual([]);
    expect(await storedRows(event.gameId)).toEqual({ games: 0, players: 0, stats: 0 });
    expect(error).toHaveBeenCalledWith("game_event_host_missing", { gameId: event.gameId, hostId: event.hostId });
  });

  it("skema rusak (poison message) -> ack tanpa insert, gameId dicatat kalau terbaca", async () => {
    const error = vi.spyOn(log, "error");
    const event = gameEvent(await newHost());
    const result = await consume({ ...event, players: "bukan daftar" });
    expect(result.explicitAcks).toEqual(["m1"]);
    expect(result.retryMessages).toEqual([]);
    expect(await storedRows(event.gameId)).toEqual({ games: 0, players: 0, stats: 0 });
    expect(error).toHaveBeenCalledWith("game_ended_invalid", expect.objectContaining({ gameId: event.gameId }));
  });

  it("D1 gagal -> retry tanpa ack, tidak ada baris setengah jadi", async () => {
    vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1_ERROR: database sibuk"));
    const event = gameEvent(await newHost());
    const result = await consume(event, 3);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toMatchObject([{ msgId: "m1" }]);
    expect(await storedRows(event.gameId)).toEqual({ games: 0, players: 0, stats: 0 });
  });

  it("D1 gagal pada percobaan ke-3 -> retry dengan jeda 240 detik", async () => {
    // getQueueResult tidak melaporkan delaySeconds, jadi pesan dibuat sendiri untuk melihat argumen retry.
    vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1_ERROR: database sibuk"));
    const message = { id: "m1", timestamp: new Date(), attempts: 3, body: gameEvent(await newHost()), ack: vi.fn(), retry: vi.fn() };
    await consumeGameEvents([message], env.DB, Date.now());
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 240 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it.each([
    [MAX_PLAYERS_PER_ROOM, 20],
    [MAX_PLAYERS_PER_ROOM, MAX_QUESTIONS_PER_QUIZ],
  ])("anggaran tulis: %i pemain, %i soal", async (players, questions) => {
    const info = vi.spyOn(log, "info");
    const event = gameEvent(await newHost(), { players, questions });
    await consume(event);
    expect(await storedRows(event.gameId)).toEqual({ games: 1, players, stats: questions });
    const rowsWritten = info.mock.calls.filter(([event]) => event === "game_event_saved").at(-1)?.[1]?.rowsWritten;
    console.info(`rows_written ${players} pemain, ${questions} soal: ${String(rowsWritten)}`);
    // games 1 baris + 3 indeks, game_players dan game_question_stats WITHOUT ROWID: 1 baris per pemain/soal.
    expect(rowsWritten).toBe(4 + players + questions);
  });
});
