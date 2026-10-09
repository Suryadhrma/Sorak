import { CloseCode } from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayerSession } from "../src/player-session.ts";
import type { PlayerScreen } from "../src/player-screen.ts";
import type { ConnectionStatus } from "../src/socket.ts";
import { installBrowserFakes, type FakeWebSocket } from "./fake-websocket.ts";

const PIN = "123456";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const TOKEN_KEY = `sorak:session:${PIN}`;
const QUEUE_KEY = `sorak:answer:${PIN}`;

let fakes: ReturnType<typeof installBrowserFakes>;

beforeEach(() => {
  vi.useFakeTimers();
  fakes = installBrowserFakes();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const question = { t: "question", q: 0, total: 3, prompt: "1 + 1?", options: ["1", "2"], durationMs: 20_000, imageUrl: null };

const welcome = (snapshot: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  t: "welcome",
  v: 1,
  playerId: "p1",
  nickname: "Dimas",
  room: { pin: PIN, scoringMode: "classic", teamMode: false, questionCount: 3 },
  snapshot: { phase: "lobby", question: null, remainingMs: null, answered: false, score: 0, streak: 0, rank: null, playerCount: 4, ...snapshot },
  ...extra,
});

/** Snapshot setelah tersambung lagi di tengah soal pertama. */
const midQuestion = (answered: boolean) =>
  welcome({ phase: "question", question: { ...question, t: undefined }, remainingMs: 15_000, answered, rank: 1 });

function session() {
  const screens: PlayerScreen[] = [];
  const statuses: ConnectionStatus[] = [];
  const player = createPlayerSession(
    PIN,
    (screen) => screens.push(screen),
    (status) => statuses.push(status),
  );
  return { player, view: () => screens.at(-1)?.view, status: () => statuses.at(-1) };
}

const sentOfType = (ws: FakeWebSocket, type: string) => ws.sentMessages().filter((message) => (message as { t: string }).t === type);

/** Join sampai lobby, lalu soal pertama tampil. */
function joinedAtQuestion() {
  const result = session();
  result.player.join("Dimas");
  const ws = fakes.latest();
  ws.serverOpen();
  ws.serverSend(welcome({}, { sessionToken: TOKEN }));
  ws.serverSend(question);
  return { ...result, ws };
}

describe("player session", () => {
  it("tanpa token, start menanyakan nickname", () => {
    const { player, view } = session();
    player.start();
    expect(view()).toEqual({ kind: "nickname", error: null, busy: false });
  });

  it("join menyimpan token per PIN dan menampilkan lobby", () => {
    const { player, view } = session();
    player.start();
    player.join("Dimas");
    const ws = fakes.latest();
    ws.serverOpen();
    expect(ws.sentMessages()).toEqual([{ t: "join", v: 1, nickname: "Dimas" }]);
    ws.serverSend(welcome({}, { sessionToken: TOKEN }));
    expect(fakes.storage.get(TOKEN_KEY)).toBe(TOKEN);
    expect(view()).toEqual({ kind: "lobby", me: { playerId: "p1", nickname: "Dimas" }, playerCount: 4 });
  });

  it("NICKNAME_TAKEN tampil di form, nama berikutnya dikirim lewat socket yang sama", () => {
    const { player, view } = session();
    player.join("Dimas");
    const ws = fakes.latest();
    ws.serverOpen();
    ws.serverSend({ t: "error", code: "NICKNAME_TAKEN", message: "x" });
    expect(view()).toMatchObject({ kind: "nickname", error: expect.stringContaining("sudah dipakai"), busy: false });
    player.join("Dimas 2");
    expect(fakes.latest()).toBe(ws);
    expect(ws.sentMessages().at(-1)).toEqual({ t: "join", v: 1, nickname: "Dimas 2" });
  });

  it("dengan token tersimpan, start langsung resume", () => {
    fakes.storage.set(TOKEN_KEY, TOKEN);
    const { player, view } = session();
    player.start();
    expect(view()).toEqual({ kind: "connecting" });
    fakes.latest().serverOpen();
    expect(fakes.latest().sentMessages()).toEqual([{ t: "resume", v: 1, sessionToken: TOKEN }]);
  });

  it("setiap soal di-ack, sekali per soal yang diterima", () => {
    const { ws } = joinedAtQuestion();
    expect(sentOfType(ws, "ack")).toEqual([{ t: "ack", q: 0 }]);
  });

  it("jawaban dikirim sekali dengan lama berpikir sejak soal tampil, tersimpan sampai server mengonfirmasi", () => {
    const { player, ws, view } = joinedAtQuestion();
    vi.advanceTimersByTime(3000);
    player.answer(1);
    player.answer(0);
    expect(sentOfType(ws, "answer")).toEqual([{ t: "answer", q: 0, choice: 1, elapsedMs: 3000 }]);
    expect(JSON.parse(fakes.storage.get(QUEUE_KEY) ?? "null")).toEqual({ q: 0, choice: 1, elapsedMs: 3000 });
    expect(view()).toMatchObject({ kind: "question", choice: 1, confirmed: false });

    ws.serverSend({ t: "answer_received", q: 0 });
    expect(view()).toMatchObject({ kind: "question", choice: 1, confirmed: true });
    expect(fakes.storage.has(QUEUE_KEY)).toBe(false);
  });

  it("jawaban ditekan saat sinyal putus: tertahan, lalu dikirim ulang setelah resume kalau server belum punya", () => {
    const { player, ws: first, view } = joinedAtQuestion();
    first.serverClose(CloseCode.ABNORMAL);
    vi.advanceTimersByTime(2000);
    player.answer(1);
    expect(view()).toMatchObject({ kind: "question", choice: 1, confirmed: false });

    const second = fakes.latest();
    expect(second).not.toBe(first);
    expect(second.sent).toEqual([]);
    second.serverOpen();
    expect(second.sentMessages()).toEqual([{ t: "resume", v: 1, sessionToken: TOKEN }]);

    second.serverSend(midQuestion(false));
    // Lama berpikir tetap dari saat tombol ditekan, bukan saat terkirim.
    expect(sentOfType(second, "answer")).toEqual([{ t: "answer", q: 0, choice: 1, elapsedMs: 2000 }]);
    expect(view()).toMatchObject({ kind: "question", choice: 1, confirmed: false });
    second.serverSend({ t: "answer_received", q: 0 });
    expect(view()).toMatchObject({ confirmed: true });
  });

  it("server sudah punya jawabannya (snapshot answered): antrean dibuang, tidak dikirim ulang", () => {
    const { player, ws: first } = joinedAtQuestion();
    player.answer(1);
    first.serverClose(CloseCode.ABNORMAL);
    vi.advanceTimersByTime(1000);
    const second = fakes.latest();
    second.serverOpen();
    second.serverSend(midQuestion(true));
    expect(sentOfType(second, "answer")).toEqual([]);
    expect(fakes.storage.has(QUEUE_KEY)).toBe(false);
  });

  it("antrean selamat dari muat ulang halaman", () => {
    fakes.storage.set(TOKEN_KEY, TOKEN);
    fakes.storage.set(QUEUE_KEY, JSON.stringify({ q: 0, choice: 1, elapsedMs: 4000 }));
    const { player, view } = session();
    player.start();
    const ws = fakes.latest();
    ws.serverOpen();
    ws.serverSend(midQuestion(false));
    expect(sentOfType(ws, "answer")).toEqual([{ t: "answer", q: 0, choice: 1, elapsedMs: 4000 }]);
    expect(view()).toMatchObject({ kind: "question", choice: 1 });
  });

  it("4003 di tengah game: token dan antrean dibuang, layar menjelaskan", () => {
    const { player, ws, view } = joinedAtQuestion();
    player.answer(1);
    ws.serverClose(CloseCode.SESSION_INVALID);
    expect(fakes.storage.has(TOKEN_KEY)).toBe(false);
    expect(fakes.storage.has(QUEUE_KEY)).toBe(false);
    expect(view()).toMatchObject({ kind: "ended", message: expect.stringContaining("Game sudah berjalan") });
  });

  it("4002 dibuka di tempat lain: Pakai di sini resume dengan token yang sama", () => {
    const { player, ws, view } = joinedAtQuestion();
    ws.serverClose(CloseCode.REPLACED);
    expect(view()).toMatchObject({ kind: "ended", takeOver: true });
    vi.advanceTimersByTime(60_000);
    expect(fakes.latest()).toBe(ws);

    player.takeOver();
    const taken = fakes.latest();
    expect(taken).not.toBe(ws);
    taken.serverOpen();
    expect(taken.sentMessages()).toEqual([{ t: "resume", v: 1, sessionToken: TOKEN }]);
  });

  it("room dibatalkan guru di lobby (4000) -> teks lobby", () => {
    const { player, view } = session();
    player.join("Dimas");
    const ws = fakes.latest();
    ws.serverOpen();
    ws.serverSend(welcome({}, { sessionToken: TOKEN }));
    ws.serverClose(CloseCode.ROOM_CLOSED);
    expect(view()).toEqual({ kind: "ended", message: "Room ditutup oleh guru.", takeOver: false });
  });

  it("Sambung sekarang tidak menunggu sisa jeda", () => {
    const { player, ws, status } = joinedAtQuestion();
    ws.serverClose(CloseCode.ABNORMAL);
    expect(status()).toMatchObject({ kind: "waiting" });
    player.retryNow();
    expect(fakes.latest()).not.toBe(ws);
    expect(status()).toEqual({ kind: "connecting", attempt: 1 });
  });

  it("localStorage diblokir: join tetap jalan, hanya tanpa resume", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    const { player, view } = session();
    player.start();
    player.join("Dimas");
    fakes.latest().serverOpen();
    fakes.latest().serverSend(welcome({}, { sessionToken: TOKEN }));
    expect(view()).toMatchObject({ kind: "lobby" });
  });
});
