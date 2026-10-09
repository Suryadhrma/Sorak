import {
  CloseCode,
  HEARTBEAT,
  RECONNECT_BACKOFF_MS,
  RECONNECT_JITTER_RATIO,
  decodePlayerServerMessage,
  type PlayerServerMessage,
} from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeMessage, connectRoom, reconnectDelay, type ConnectionStatus } from "../src/socket.ts";
import { installBrowserFakes } from "./fake-websocket.ts";

let fakes: ReturnType<typeof installBrowserFakes>;

beforeEach(() => {
  vi.useFakeTimers();
  fakes = installBrowserFakes();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SESSION_TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

function connect() {
  const messages: PlayerServerMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  const ends: number[] = [];
  const connection = connectRoom({
    path: "/ws/play/123456",
    opening: () => ({ t: "resume", v: 1, sessionToken: SESSION_TOKEN }),
    decode: decodePlayerServerMessage,
    onMessage: (message) => messages.push(message),
    onStatus: (status) => statuses.push(status),
    onEnd: (code) => ends.push(code),
  });
  return { connection, messages, statuses, ends, lastStatus: () => statuses.at(-1) };
}

describe("reconnectDelay", () => {
  it.each(RECONNECT_BACKOFF_MS.map((base, attempt) => [attempt, base]))(
    "percobaan %i: antara jeda dasar %i dan dasar + 50%",
    (attempt, base) => {
      expect(reconnectDelay(attempt, 0)).toBe(base);
      expect(reconnectDelay(attempt, 0.999)).toBeLessThan(base * (1 + RECONNECT_JITTER_RATIO));
      expect(reconnectDelay(attempt, 0.999)).toBeGreaterThan(base);
    },
  );

  it("setelah tangga habis, jeda berhenti di langkah terakhir", () => {
    const last = RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];
    expect(reconnectDelay(50, 0)).toBe(last);
  });
});

describe("connectRoom", () => {
  it("memakai wss di halaman https dan mengirim pesan pembuka saat tersambung", () => {
    const { lastStatus } = connect();
    const ws = fakes.latest();
    expect(ws.url).toBe("wss://sorak.test/ws/play/123456");
    expect(lastStatus()).toEqual({ kind: "connecting", attempt: 0 });
    expect(ws.sent).toEqual([]);
    ws.serverOpen();
    expect(lastStatus()).toEqual({ kind: "open" });
    expect(ws.sentMessages()).toEqual([{ t: "resume", v: 1, sessionToken: SESSION_TOKEN }]);
  });

  it("meneruskan pesan valid, mengabaikan pong dan jenis pesan yang belum dikenal", () => {
    const { messages } = connect();
    const ws = fakes.latest();
    ws.serverOpen();
    ws.serverSend("pong");
    ws.serverSend({ t: "future_message" });
    ws.serverSend({ t: "lobby", playerCount: 3 });
    expect(messages).toEqual([{ t: "lobby", playerCount: 3 }]);
  });

  it("putus biasa -> menunggu jeda backoff, lalu socket baru mengirim resume lagi", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { lastStatus, ends } = connect();
    const first = fakes.latest();
    first.serverOpen();
    first.serverClose(CloseCode.ABNORMAL);

    expect(lastStatus()).toMatchObject({ kind: "waiting", attempt: 1, delayMs: RECONNECT_BACKOFF_MS[0] });
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0] - 1);
    expect(fakes.latest()).toBe(first);
    vi.advanceTimersByTime(1);

    const second = fakes.latest();
    expect(second).not.toBe(first);
    second.serverOpen();
    expect(second.sentMessages()).toEqual([{ t: "resume", v: 1, sessionToken: SESSION_TOKEN }]);
    expect(ends).toEqual([]);
  });

  it("gagal berturut-turut menaikkan jeda; markHealthy mengembalikannya ke yang terpendek", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { connection, lastStatus } = connect();
    fakes.latest().serverClose(CloseCode.ABNORMAL);
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    fakes.latest().serverClose(CloseCode.ABNORMAL);
    expect(lastStatus()).toMatchObject({ kind: "waiting", attempt: 2, delayMs: RECONNECT_BACKOFF_MS[1] });

    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[1]);
    fakes.latest().serverOpen();
    connection.markHealthy();
    fakes.latest().serverClose(CloseCode.ABNORMAL);
    expect(lastStatus()).toMatchObject({ kind: "waiting", attempt: 1, delayMs: RECONNECT_BACKOFF_MS[0] });
  });

  it.each([CloseCode.KICKED, CloseCode.REPLACED, CloseCode.SESSION_INVALID, CloseCode.ROOM_CLOSED])(
    "close %i adalah keputusan server: tidak reconnect, dilaporkan lewat onEnd",
    (code) => {
      const { ends } = connect();
      const ws = fakes.latest();
      ws.serverOpen();
      ws.serverClose(code);
      vi.advanceTimersByTime(60_000);
      expect(fakes.latest()).toBe(ws);
      expect(ends).toEqual([code]);
    },
  );

  it("event online saat menunggu -> langsung mencoba tanpa sisa jeda", () => {
    const { lastStatus } = connect();
    const first = fakes.latest();
    first.serverOpen();
    first.serverClose(CloseCode.ABNORMAL);
    expect(lastStatus()).toMatchObject({ kind: "waiting" });

    fakes.window.dispatchEvent(new Event("online"));
    expect(fakes.latest()).not.toBe(first);
    expect(lastStatus()).toEqual({ kind: "connecting", attempt: 1 });
  });

  it("tab terlihat lagi -> langsung mencoba; tab tersembunyi tidak memicu apa pun", () => {
    connect();
    const first = fakes.latest();
    first.serverClose(CloseCode.ABNORMAL);

    fakes.document.visibilityState = "hidden";
    fakes.document.dispatchEvent(new Event("visibilitychange"));
    expect(fakes.latest()).toBe(first);

    fakes.document.visibilityState = "visible";
    fakes.document.dispatchEvent(new Event("visibilitychange"));
    expect(fakes.latest()).not.toBe(first);
  });

  it("retryNow saat socket masih terbuka tidak membuka socket kedua", () => {
    const { connection } = connect();
    const ws = fakes.latest();
    ws.serverOpen();
    connection.retryNow();
    expect(fakes.latest()).toBe(ws);
  });

  it("tanpa pong dalam timeout, socket dianggap mati lalu reconnect", () => {
    const { lastStatus, ends } = connect();
    const ws = fakes.latest();
    ws.serverOpen();
    vi.advanceTimersByTime(HEARTBEAT.intervalMs);
    expect(ws.sent.at(-1)).toBe(HEARTBEAT.request);
    vi.advanceTimersByTime(HEARTBEAT.timeoutMs);

    expect(lastStatus()).toMatchObject({ kind: "waiting", attempt: 1 });
    expect(ends).toEqual([]);
    // Close yang datang terlambat dari socket mati itu tidak memicu reconnect kedua.
    ws.serverClose(CloseCode.ABNORMAL);
    expect(lastStatus()).toMatchObject({ kind: "waiting", attempt: 1 });
  });

  it("pong tepat waktu menjaga koneksi", () => {
    const { lastStatus } = connect();
    const ws = fakes.latest();
    ws.serverOpen();
    vi.advanceTimersByTime(HEARTBEAT.intervalMs);
    ws.serverSend(HEARTBEAT.response);
    vi.advanceTimersByTime(HEARTBEAT.timeoutMs);
    expect(lastStatus()).toEqual({ kind: "open" });
  });

  it("close() dari kita: tidak reconnect, event online diabaikan", () => {
    const { connection, ends } = connect();
    const ws = fakes.latest();
    ws.serverOpen();
    connection.close();
    ws.serverClose(CloseCode.NORMAL);
    fakes.window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(60_000);
    expect(ws.closedWith).toBe(CloseCode.NORMAL);
    expect(fakes.latest()).toBe(ws);
    expect(ends).toEqual([]);
  });

  it("send mengembalikan false saat socket belum terbuka", () => {
    const { connection } = connect();
    expect(connection.send({ t: "ack", q: 0 })).toBe(false);
    fakes.latest().serverOpen();
    expect(connection.send({ t: "ack", q: 0 })).toBe(true);
  });
});

describe("closeMessage", () => {
  it("kode yang dikenal punya teks sendiri", () => {
    expect(closeMessage(CloseCode.ROOM_FULL)).toBe("Room sudah penuh.");
  });

  it("kode yang tidak dikenal tetap punya teks", () => {
    expect(closeMessage(4999)).toBe("Koneksi ditutup.");
  });
});
