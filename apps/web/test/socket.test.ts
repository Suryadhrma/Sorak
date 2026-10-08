import { CloseCode, HEARTBEAT, decodePlayerServerMessage, type PlayerServerMessage } from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeMessage, openRoomSocket } from "../src/socket.ts";
import { installBrowserFakes } from "./fake-websocket.ts";

let fakes: ReturnType<typeof installBrowserFakes>;

beforeEach(() => {
  vi.useFakeTimers();
  fakes = installBrowserFakes();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open() {
  const messages: PlayerServerMessage[] = [];
  const closes: number[] = [];
  const socket = openRoomSocket({
    path: "/ws/play/123456",
    opening: { t: "join", v: 1, nickname: "Dimas" },
    decode: decodePlayerServerMessage,
    onMessage: (message) => messages.push(message),
    onClose: (code) => closes.push(code),
  });
  return { socket, messages, closes, ws: fakes.latest() };
}

describe("openRoomSocket", () => {
  it("memakai wss di halaman https dan mengirim pesan pembuka saat tersambung", () => {
    const { ws } = open();
    expect(ws.url).toBe("wss://sorak.test/ws/play/123456");
    expect(ws.sent).toEqual([]);
    ws.serverOpen();
    expect(ws.sentMessages()).toEqual([{ t: "join", v: 1, nickname: "Dimas" }]);
  });

  it("meneruskan pesan valid, mengabaikan pong dan jenis pesan yang belum dikenal", () => {
    const { ws, messages } = open();
    ws.serverOpen();
    ws.serverSend("pong");
    ws.serverSend({ t: "future_message" });
    ws.serverSend({ t: "lobby", playerCount: 3 });
    expect(messages).toEqual([{ t: "lobby", playerCount: 3 }]);
  });

  it("mengirim ping tiap interval; pong tepat waktu menjaga koneksi", () => {
    const { ws, closes } = open();
    ws.serverOpen();
    vi.advanceTimersByTime(HEARTBEAT.intervalMs);
    expect(ws.sent.at(-1)).toBe("ping");
    ws.serverSend("pong");
    vi.advanceTimersByTime(HEARTBEAT.timeoutMs);
    expect(closes).toEqual([]);
  });

  it("tanpa pong dalam timeout, koneksi dianggap mati dan dilaporkan sekali", () => {
    const { ws, closes } = open();
    ws.serverOpen();
    vi.advanceTimersByTime(HEARTBEAT.intervalMs + HEARTBEAT.timeoutMs);
    expect(closes).toEqual([CloseCode.ABNORMAL]);
    ws.serverClose(1006);
    expect(closes).toEqual([CloseCode.ABNORMAL]);
  });

  it("close dari server dilaporkan dengan kodenya", () => {
    const { ws, closes } = open();
    ws.serverOpen();
    ws.serverClose(CloseCode.ROOM_CLOSED);
    expect(closes).toEqual([CloseCode.ROOM_CLOSED]);
  });

  it("close() dari kita tidak dilaporkan sebagai putus", () => {
    const { socket, ws, closes } = open();
    ws.serverOpen();
    socket.close();
    ws.serverClose(CloseCode.NORMAL);
    expect(ws.closedWith).toBe(CloseCode.NORMAL);
    expect(closes).toEqual([]);
  });
});

describe("closeMessage", () => {
  it.each([
    [CloseCode.ABNORMAL, true],
    [CloseCode.GOING_AWAY, true],
    [CloseCode.ROOM_CLOSED, false],
    [CloseCode.REPLACED, false],
  ])("kode %i: Masuk lagi = %s", (code, canRetry) => {
    expect(closeMessage(code).canRetry).toBe(canRetry);
  });

  it("kode yang tidak dikenal tetap punya teks", () => {
    expect(closeMessage(4999)).toEqual({ message: "Koneksi ditutup.", canRetry: false });
  });
});
