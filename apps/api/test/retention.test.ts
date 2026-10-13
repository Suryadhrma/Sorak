import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { GAME_RESULT_RETENTION_DAYS, RETENTION_DELETE_BATCH } from "@sorak/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { log } from "../src/log.ts";
import { DELETE_EXPIRED_SQL } from "../src/retention.ts";
import { consume, gameEvent, storedRows } from "./games.ts";
import { insertHost } from "./http.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const DAY_MS = 86_400_000;

async function runCron(now: number): Promise<void> {
  await worker.scheduled(createScheduledController({ scheduledTime: new Date(now), cron: "17 19 * * *" }), env);
}

async function storedGame(hostId: string, ageDays: number, now: number): Promise<string> {
  const event = gameEvent(hostId, { endedAt: now - ageDays * DAY_MS });
  await consume(event);
  return event.gameId;
}

describe(`cron retensi ${GAME_RESULT_RETENTION_DAYS} hari`, () => {
  it("game berumur 31 hari terhapus beserta anaknya (ON DELETE CASCADE); 29 hari tetap ada", async () => {
    const hostId = crypto.randomUUID();
    await insertHost({ id: hostId, email: `${hostId}@example.com` });
    const now = Date.now();
    const old = await storedGame(hostId, 31, now);
    const recent = await storedGame(hostId, 29, now);
    expect(await storedRows(old)).toEqual({ games: 1, players: 3, stats: 2 });

    await runCron(now);
    expect(await storedRows(old)).toEqual({ games: 0, players: 0, stats: 0 });
    expect(await storedRows(recent)).toEqual({ games: 1, players: 3, stats: 2 });
  });

  it("foreign key memang aktif di D1: baris anak tanpa game ditolak", async () => {
    const orphan = env.DB.prepare(
      "INSERT INTO game_players (game_id, player_id, nickname, final_score, final_rank, correct_count, answered_count) VALUES (?, 'p', 'Andi', 0, 1, 0, 0)",
    ).bind(crypto.randomUUID());
    await expect(orphan.run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it(`lebih dari ${RETENTION_DELETE_BATCH} game kedaluwarsa -> dihapus dalam beberapa putaran, log retention_cleanup`, async () => {
    const info = vi.spyOn(log, "info");
    const hostId = crypto.randomUUID();
    await insertHost({ id: hostId, email: `${hostId}@example.com` });
    // Waktu cron jauh di depan supaya game yang dibuat test ini pasti kedaluwarsa.
    const now = Date.now() + 400 * DAY_MS;
    const ids: string[] = [];
    for (let i = 0; i < RETENTION_DELETE_BATCH + 5; i++) ids.push(await storedGame(hostId, 31, now));

    // Storage D1 dipakai bersama test lain di file ini; jumlah yang kedaluwarsa dihitung dulu supaya angkanya pasti.
    const cutoff = now - GAME_RESULT_RETENTION_DAYS * DAY_MS;
    const expired = await env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE ended_at < ?").bind(cutoff).first<{ n: number }>();
    expect(expired?.n).toBeGreaterThanOrEqual(RETENTION_DELETE_BATCH + 5);

    await runCron(now);
    for (const id of ids) expect((await storedRows(id)).games).toBe(0);
    const cleanup = info.mock.calls.find(([event]) => event === "retention_cleanup");
    expect(cleanup?.[1]).toMatchObject({ deleted: expired?.n });
    expect(info.mock.calls.some(([event]) => event === "retention_backlog")).toBe(false);
  });

  it("EXPLAIN QUERY PLAN: game kedaluwarsa dicari lewat games_ended_idx, bukan SCAN", async () => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${DELETE_EXPIRED_SQL}`)
      .bind(0, RETENTION_DELETE_BATCH)
      .all<{ detail: string }>();
    const details = results.map((row) => row.detail);
    expect(details).toContainEqual(expect.stringMatching(/SEARCH games USING (COVERING )?INDEX games_ended_idx \(ended_at<\?\)/));
    expect(details.filter((detail) => detail.startsWith("SCAN games"))).toEqual([]);
  });
});
