import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  CloseCode,
  ENDED_RETENTION_MS,
  GAME_EVENT_GIVE_UP_MS,
  GAME_EVENT_RETRY_MS,
  GameEndedEvent,
  RoomState,
  StorageKey,
} from "@sorak/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/log.ts";
import {
  alarm,
  answer,
  countStorageWrites,
  expectGraceEverywhere,
  expectNext,
  expectQuestionEverywhere,
  lobbyWith,
  roomStub,
  startedGame,
  type Client,
  type Player,
} from "./room.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Game = { pin: string; host: Client; players: Player[] };

/** Semua pemain menjawab benar soal q, lalu grace dan reveal selesai dibaca. */
async function playQuestion(game: Game, q: number): Promise<void> {
  for (const player of game.players) {
    answer(player, q, 1);
    await expectNext(player.client, { t: "answer_received", q });
  }
  for (const _ of game.players) await expectNext(game.host, { t: "answer_count", q });
  await expectGraceEverywhere(game, q);
  await alarm(game.pin);
  await expectNext(game.host, { t: "reveal", q });
  for (const player of game.players) await expectNext(player.client, { t: "result", q });
}

/** Game 3 soal dimainkan sampai reveal soal terakhir; podium belum diminta. */
async function gameAtLastReveal(): Promise<Game> {
  const game = await startedGame(["Andi", "Budi"]);
  for (const q of [0, 1, 2]) {
    if (q > 0) {
      game.host.send({ t: "next" });
      await expectQuestionEverywhere(game, q);
    }
    await playQuestion(game, q);
  }
  return game;
}

async function expectPodiumEverywhere(game: Game): Promise<void> {
  await expectNext(game.host, { t: "podium", playerCount: game.players.length });
  for (const player of game.players) await expectNext(player.client, { t: "final" });
}

const stored = (pin: string) =>
  runInDurableObject(roomStub(pin), async (_instance, state) => ({
    room: RoomState.parse(await state.storage.get(StorageKey.state)),
    alarmAt: await state.storage.getAlarm(),
  }));

describe("event game_ended ke Queue", () => {
  it("game 3 soal selesai -> tepat satu event yang lolos skema; tulis storage sama dengan Hari 3", async () => {
    const send = vi.spyOn(env.GAME_EVENTS, "send");
    const game = await gameAtLastReveal();
    const writes = await countStorageWrites(game.pin);
    game.host.send({ t: "next" });
    await expectPodiumEverywhere(game);

    expect(send).toHaveBeenCalledTimes(1);
    const event = GameEndedEvent.parse(send.mock.calls[0]?.[0]);
    expect(event.questions).toHaveLength(3);
    expect(event.players.map((player) => player.correctCount)).toEqual([3, 3]);

    const { room, alarmAt } = await stored(game.pin);
    expect(room).toMatchObject({ phase: "ended", gameEventAttempts: 0 });
    expect(room.gameEventSentAt).toBe(room.endedAt);
    expect(alarmAt).toBe((room.endedAt ?? 0) + ENDED_RETENTION_MS);
    const rows = await writes();
    console.info(`baris tulis storage saat game selesai (jalur normal): ${JSON.stringify(rows)}`);
    expect(rows).toEqual({ put: 1, setAlarm: 1, delete: 0 });
  });

  it("room dibatalkan di lobby, atau diakhiri sebelum reveal pertama -> tidak ada event, bukan error", async () => {
    const send = vi.spyOn(env.GAME_EVENTS, "send");
    const logged = vi.spyOn(log, "error");
    const lobby = await lobbyWith(["Andi"]);
    lobby.host.send({ t: "end" });
    expect(await lobby.host.closed).toMatchObject({ code: CloseCode.ROOM_CLOSED });

    const early = await startedGame(["Budi"]);
    early.host.send({ t: "end" });
    await expectNext(early.host, { t: "podium" });
    expect(send).not.toHaveBeenCalled();
    // Tidak ada hasil yang layak disimpan: itu keadaan normal, bukan event rusak.
    expect(logged).not.toHaveBeenCalled();
    expect((await stored(early.pin)).room).toMatchObject({ gameEventSentAt: null, gameEventAttempts: 0 });
  });

  it("Queue melempar -> podium tetap terkirim, alarm retry terpasang, lalu alarm berikutnya mengirim ulang dan berhasil", async () => {
    const send = vi.spyOn(env.GAME_EVENTS, "send").mockRejectedValueOnce(new Error("queue down"));
    const game = await gameAtLastReveal();
    game.host.send({ t: "next" });
    await expectPodiumEverywhere(game);

    const failed = await stored(game.pin);
    expect(failed.room).toMatchObject({ phase: "ended", gameEventSentAt: null, gameEventAttempts: 1 });
    expect(failed.alarmAt).toBe((failed.room.endedAt ?? 0) + GAME_EVENT_RETRY_MS[0]);

    const writes = await countStorageWrites(game.pin);
    await alarm(game.pin);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
    const resent = await stored(game.pin);
    expect(resent.room.gameEventSentAt).not.toBeNull();
    expect(resent.alarmAt).toBe((resent.room.endedAt ?? 0) + ENDED_RETENTION_MS);
    const rows = await writes();
    console.info(`baris tulis storage satu percobaan ulang yang berhasil: ${JSON.stringify(rows)}`);
    expect(rows).toEqual({ put: 1, setAlarm: 1, delete: 0 });
  });

  it("percobaan ulang gagal lagi -> jeda berikutnya dari GAME_EVENT_RETRY_MS", async () => {
    vi.spyOn(env.GAME_EVENTS, "send").mockRejectedValue(new Error("queue down"));
    const game = await gameAtLastReveal();
    game.host.send({ t: "next" });
    await expectPodiumEverywhere(game);

    const writes = await countStorageWrites(game.pin);
    const before = Date.now();
    await alarm(game.pin);
    const { room, alarmAt } = await stored(game.pin);
    expect(room).toMatchObject({ gameEventSentAt: null, gameEventAttempts: 2 });
    expect(alarmAt).toBeGreaterThanOrEqual(before + GAME_EVENT_RETRY_MS[1]);
    expect(alarmAt).toBeLessThan(before + GAME_EVENT_RETRY_MS[2]);
    const rows = await writes();
    console.info(`baris tulis storage satu percobaan ulang yang gagal: ${JSON.stringify(rows)}`);
    expect(rows).toEqual({ put: 1, setAlarm: 1, delete: 0 });
  });

  it("lewat GAME_EVENT_GIVE_UP_MS -> log game_event_lost, room dibersihkan", async () => {
    const send = vi.spyOn(env.GAME_EVENTS, "send").mockRejectedValue(new Error("queue down"));
    const logged = vi.spyOn(log, "error");
    const game = await gameAtLastReveal();
    game.host.send({ t: "next" });
    await expectPodiumEverywhere(game);
    const { room } = await stored(game.pin);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((room.endedAt ?? 0) + GAME_EVENT_GIVE_UP_MS);
    await alarm(game.pin);

    expect(send).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith("game_event_lost", { gameId: room.gameId, hostId: room.hostId, players: 2 });
    expect(await game.host.closed).toMatchObject({ code: CloseCode.ROOM_CLOSED });
    await runInDurableObject(roomStub(game.pin), async (_instance, state) => {
      expect((await state.storage.list()).size).toBe(0);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});
