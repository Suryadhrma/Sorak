import { env } from "cloudflare:workers";
import { GAMES_PAGE_SIZE, GameDetail, GameListResponse } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { LIST_GAMES_AFTER_SQL, LIST_GAMES_SQL, decodeGameCursor, encodeGameCursor } from "../src/game-history.ts";
import { consume, gameEvent } from "./games.ts";
import { request, signedInHost } from "./http.ts";

/** Game selesai yang sudah tersimpan lewat consumer, milik host `hostId`. */
async function storedGame(hostId: string, options: Parameters<typeof gameEvent>[1] = {}) {
  const event = gameEvent(hostId, options);
  await consume(event);
  return event;
}

describe("cursor halaman (murni)", () => {
  const cursor = { endedAt: 1_790_000_000_000, id: "7c9e6679-7425-40de-944b-e07fc1f90ae7" };

  it("bolak-balik encode lalu decode menghasilkan cursor yang sama, aman di URL", () => {
    const encoded = encodeGameCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeGameCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ["bukan base64url", "%%%"],
    ["base64 tapi bukan JSON", btoa("bukan json")],
    ["JSON dengan bentuk lain", btoa(JSON.stringify({ endedAt: "kemarin", id: cursor.id }))],
    ["id bukan UUID", btoa(JSON.stringify({ endedAt: 1, id: "1 OR 1=1" }))],
  ])("cursor rusak (%s) -> null", (_case, raw) => {
    expect(decodeGameCursor(raw)).toBeNull();
  });
});

describe("GET /api/games", () => {
  it(`${GAMES_PAGE_SIZE + 5} game -> halaman ${GAMES_PAGE_SIZE} lalu 5, terbaru dulu, tanpa ganda walau ada waktu selesai yang sama`, async () => {
    const host = await signedInHost();
    const base = Date.now();
    // Berpasangan dengan waktu selesai yang sama, digeser satu supaya game ke-20 dan ke-21 seri tepat di batas
    // halaman: tanpa pemecah seri id, salah satunya hilang atau muncul dua kali.
    for (let i = 0; i < GAMES_PAGE_SIZE + 5; i++) await storedGame(host.id, { endedAt: base - Math.floor((i + 1) / 2) * 60_000 });

    const first = GameListResponse.parse(await (await host.send("/api/games")).json());
    expect(first.games).toHaveLength(GAMES_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = GameListResponse.parse(await (await host.send(`/api/games?cursor=${first.nextCursor}`)).json());
    expect(second.games).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const all = [...first.games, ...second.games];
    expect(new Set(all.map((game) => game.id)).size).toBe(GAMES_PAGE_SIZE + 5);
    const sorted = [...all].sort((a, b) => b.endedAt - a.endedAt || (a.id < b.id ? 1 : -1));
    expect(all.map((game) => game.id)).toEqual(sorted.map((game) => game.id));
    expect(all[0]).toMatchObject({ quizTitle: "Kuis IPA", pin: "123456", scoringMode: "classic", playerCount: 3, questionCount: 2 });
  });

  it("hanya game milik host yang login", async () => {
    const owner = await signedInHost();
    const other = await signedInHost();
    await storedGame(owner.id);
    const list = GameListResponse.parse(await (await other.send("/api/games")).json());
    expect(list).toEqual({ games: [], nextCursor: null });
  });

  it("cursor rusak -> 400", async () => {
    const host = await signedInHost();
    const res = await host.send("/api/games?cursor=bukan-cursor");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("belum login -> 401", async () => {
    expect((await request("/api/games")).status).toBe(401);
  });
});

describe("GET /api/games/:id", () => {
  it("laporan: pemain urut peringkat lalu nama, soal urut posisi, kolom JSON sudah di-parse", async () => {
    const host = await signedInHost();
    const event = gameEvent(host.id, { players: 3, questions: 2 });
    // Dua pemain seri di peringkat 1: urutannya ditentukan nama.
    const [a, b, c] = event.players;
    if (!a || !b || !c) throw new Error("event tanpa pemain");
    event.players = [
      { ...a, nickname: "Zaki", finalRank: 1 },
      { ...b, nickname: "Ayu", finalRank: 1 },
      { ...c, nickname: "Budi", finalRank: 3 },
    ];
    await consume(event);

    const res = await host.send(`/api/games/${event.gameId}`);
    expect(res.status).toBe(200);
    const game = GameDetail.parse(await res.json());
    expect(game.players.map((player) => player.nickname)).toEqual(["Ayu", "Zaki", "Budi"]);
    expect(game.questions.map((question) => question.position)).toEqual([0, 1]);
    expect(game.questions[0]).toEqual({
      position: 0,
      prompt: "Soal 1?",
      options: ["Mars", "Jupiter", "Venus", "Bumi"],
      correctIndex: 1,
      answerCounts: [1, 2, 0, 0],
      answeredCount: 3,
      correctCount: 2,
      avgAnswerMs: 4200,
    });
    expect(game).not.toHaveProperty("players.0.playerId");
  });

  it("game milik host lain, game yang tidak ada, dan id bukan UUID -> 404 yang sama", async () => {
    const owner = await signedInHost();
    const other = await signedInHost();
    const event = await storedGame(owner.id);
    const responses = await Promise.all([
      other.send(`/api/games/${event.gameId}`),
      other.send(`/api/games/${crypto.randomUUID()}`),
      other.send("/api/games/bukan-uuid"),
    ]);
    const bodies = await Promise.all(responses.map((res) => res.json()));
    expect(responses.map((res) => res.status)).toEqual([404, 404, 404]);
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
  });
});

describe("EXPLAIN QUERY PLAN riwayat", () => {
  async function plan(sql: string, ...params: unknown[]) {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    return results.map((row) => row.detail);
  }

  it.each([
    ["halaman pertama", LIST_GAMES_SQL, ["host", GAMES_PAGE_SIZE + 1]],
    ["halaman berikutnya (keyset)", LIST_GAMES_AFTER_SQL, ["host", 1, "id", GAMES_PAGE_SIZE + 1]],
  ])("%s memakai games_host_ended_idx (SEARCH, bukan SCAN)", async (_case, sql, params) => {
    const details = await plan(sql, ...params);
    console.info(`rencana ${_case}: ${details.join(" | ")}`);
    expect(details).toContainEqual(expect.stringMatching(/^SEARCH games USING INDEX games_host_ended_idx \(host_id=\?/));
    expect(details.filter((detail) => detail.startsWith("SCAN"))).toEqual([]);
  });
});
