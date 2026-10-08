import { env } from "cloudflare:workers";
import { ROOM_CONTROL_ORIGIN, RoomControlPath, RoomHeader, type InitRoomInput, type RoomRoute } from "@sorak/shared";

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

export function initInput(pin: string): InitRoomInput {
  return {
    gameId: crypto.randomUUID(),
    hostId: HOST_ID,
    pin,
    scoringMode: "classic",
    teamMode: false,
    quiz: {
      quizId: "quiz-1",
      title: "Kuis Uji",
      questions: [
        { questionId: "q1", prompt: "1 + 1?", options: ["1", "2"], correctIndex: 1, timeLimitSec: 20, imageUrl: null },
      ],
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
