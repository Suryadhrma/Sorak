import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  GRACE_MS,
  ROOM_CONTROL_ORIGIN,
  RoomControlPath,
  RoomHeader,
  type InitRoomInput,
  type RoomRoute,
  type StoredQuestion,
} from "@sorak/shared";
import { expect, vi } from "vitest";

export const HOST_ID = "host-1";

let nextPin = 100_000;
/** PIN berbeda per test, supaya setiap test mendapat GameRoom sendiri. */
export function uniquePin(): string {
  nextPin += 1;
  return String(nextPin);
}

export function roomStub(pin: string) {
  return env.GAME_ROOM.getByName(`room:${pin}`);
}

/** Soal ke-i: jawaban benar selalu opsi 1, batas waktu 20 detik. */
export function testQuestion(i: number): StoredQuestion {
  return { questionId: `q${i}`, prompt: `Soal ${i + 1}`, options: ["A", "B", "C"], correctIndex: 1, timeLimitSec: 20, imageUrl: null };
}

export function initInput(pin: string, options: { questions?: number; mode?: "classic" | "accurate" } = {}): InitRoomInput {
  return {
    gameId: crypto.randomUUID(),
    hostId: HOST_ID,
    pin,
    scoringMode: options.mode ?? "classic",
    teamMode: false,
    quiz: {
      quizId: "quiz-1",
      title: "Kuis Uji",
      questions: Array.from({ length: options.questions ?? 1 }, (_, i) => testQuestion(i)),
    },
  };
}

/** Body selalu dibaca: request yang body-nya belum dibaca membuat objek tidak pernah idle, dan evictDurableObject menunggu selamanya. */
export async function initRoom(pin: string, input: unknown = initInput(pin)): Promise<{ status: number; body: unknown }> {
  const res = await roomStub(pin).fetch(`${ROOM_CONTROL_ORIGIN}${RoomControlPath.init}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
}

export async function joinInfo(pin: string): Promise<unknown> {
  const res = await roomStub(pin).fetch(`${ROOM_CONTROL_ORIGIN}${RoomControlPath.joinInfo}`);
  return res.json();
}

export type Closed = { code: number; reason: string };

/** Klien uji: antrean pesan masuk dan janji yang selesai saat socket ditutup server. */
export type Client = {
  next(): Promise<unknown>;
  send(message: unknown): void;
  sendRaw(text: string): void;
  close(): void;
  closed: Promise<Closed>;
};

export async function connect(pin: string, route: RoomRoute, hostId?: string): Promise<Client> {
  const headers = new Headers({ Upgrade: "websocket", [RoomHeader.route]: route });
  if (hostId !== undefined) headers.set(RoomHeader.hostId, hostId);
  const res = await roomStub(pin).fetch(`${ROOM_CONTROL_ORIGIN}${RoomControlPath.connect}`, { headers });
  const ws = res.webSocket;
  if (!ws) throw new Error(`upgrade gagal: status ${res.status}`);
  ws.accept();

  const inbox: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const message = typeof event.data === "string" && event.data.startsWith("{") ? JSON.parse(event.data) : event.data;
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else inbox.push(message);
  });
  const closed = new Promise<Closed>((resolve) => {
    ws.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
  });

  return {
    next() {
      if (inbox.length > 0) return Promise.resolve(inbox.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("tidak ada pesan dalam 2 detik")), 2000);
        waiting.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    send: (message) => ws.send(JSON.stringify(message)),
    sendRaw: (text) => ws.send(text),
    close: () => ws.close(1000, "selesai"),
    closed,
  };
}

/** Pemain yang sudah join; mengembalikan klien dan pesan welcome-nya. */
export async function joinedPlayer(pin: string, nickname: string): Promise<{ client: Client; welcome: unknown }> {
  const client = await connect(pin, "play");
  client.send({ t: "join", v: 1, nickname });
  return { client, welcome: await client.next() };
}

export async function connectedHost(pin: string): Promise<{ client: Client; welcome: unknown }> {
  const client = await connect(pin, "host", HOST_ID);
  client.send({ t: "host_hello", v: 1 });
  return { client, welcome: await client.next() };
}

/** Pesan berikutnya harus cocok dengan bentuk ini (urutan pesan ikut diuji). */
export async function expectNext(client: Client, expected: Record<string, unknown>): Promise<Record<string, unknown>> {
  const message = (await client.next()) as Record<string, unknown>;
  expect(message).toMatchObject(expected);
  return message;
}

export type Player = { client: Client; playerId: string; sessionToken: string };

/** Room di lobby: host tersambung dan pemain sudah join, semua pesan lobby sudah dibaca. */
export async function lobbyWith(nicknames: string[], options: { questions?: number; mode?: "classic" | "accurate" } = {}) {
  const pin = uniquePin();
  await initRoom(pin, initInput(pin, { questions: 3, ...options }));
  const host = (await connectedHost(pin)).client;
  const players: Player[] = [];
  for (const nickname of nicknames) {
    const { client, welcome } = await joinedPlayer(pin, nickname);
    const { playerId, sessionToken } = welcome as { playerId: string; sessionToken: string };
    players.push({ client, playerId, sessionToken });
  }
  for (const _ of nicknames) await expectNext(host, { t: "player_joined" });
  for (const [i, player] of players.entries()) {
    for (let k = i; k < nicknames.length; k++) await expectNext(player.client, { t: "lobby" });
  }
  return { pin, host, players };
}

export async function startedGame(nicknames: string[], options: { questions?: number; mode?: "classic" | "accurate" } = {}) {
  const game = await lobbyWith(nicknames, options);
  game.host.send({ t: "start" });
  await expectQuestionEverywhere(game, 0);
  return game;
}

export async function expectQuestionEverywhere(game: { host: Client; players: Player[] }, q: number) {
  await expectNext(game.host, { t: "question", q, durationMs: 20_000 });
  for (const player of game.players) await expectNext(player.client, { t: "question", q });
}

export async function expectGraceEverywhere(game: { host: Client; players: Player[] }, q: number) {
  await expectNext(game.host, { t: "grace", q, ms: GRACE_MS });
  for (const player of game.players) await expectNext(player.client, { t: "grace", q });
}

export const answer = (player: Player, q: number, choice: number) => player.client.send({ t: "answer", q, choice, elapsedMs: 1000 });
export const alarm = (pin: string) => runDurableObjectAlarm(roomStub(pin));

export type StorageCounts = { put: number; setAlarm: number; delete: number };

/** Mengintip pemanggilan storage GameRoom: satu key = satu baris tulis. */
export async function countStorageWrites(pin: string): Promise<() => Promise<StorageCounts>> {
  await runInDurableObject(roomStub(pin), (_instance, state) => {
    vi.spyOn(state.storage, "put");
    vi.spyOn(state.storage, "setAlarm");
    vi.spyOn(state.storage, "delete");
  });
  return () =>
    runInDurableObject(roomStub(pin), (_instance, state) => {
      const keys = (args: unknown[]) => {
        const [first] = args;
        if (typeof first === "string") return 1;
        if (Array.isArray(first)) return first.length;
        return Object.keys(first as object).length;
      };
      const sum = (mock: { mock: { calls: unknown[][] } }) => mock.mock.calls.reduce((total, args) => total + keys(args), 0);
      return {
        put: sum(vi.mocked(state.storage.put)),
        setAlarm: vi.mocked(state.storage.setAlarm).mock.calls.length,
        delete: sum(vi.mocked(state.storage.delete)),
      };
    });
}
