import { CloseCode } from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayerSession, type PlayerView } from "../src/player-session.ts";
import { installBrowserFakes } from "./fake-websocket.ts";

const PIN = "123456";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

let fakes: ReturnType<typeof installBrowserFakes>;

beforeEach(() => {
  fakes = installBrowserFakes();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const welcome = (extra: Record<string, unknown> = {}) => ({
  t: "welcome",
  v: 1,
  playerId: "p1",
  nickname: "Dimas",
  room: { pin: PIN, scoringMode: "classic", teamMode: false, questionCount: 10 },
  snapshot: { phase: "lobby", question: null, remainingMs: null, answered: false, score: 0, streak: 0, rank: null, playerCount: 4 },
  ...extra,
});

function session() {
  const views: PlayerView[] = [];
  const player = createPlayerSession(PIN, (view) => views.push(view));
  return { player, views, last: () => views.at(-1) };
}

describe("player session", () => {
  it("tanpa token, start menanyakan nickname", () => {
    const { player, last } = session();
    player.start();
    expect(last()).toEqual({ kind: "nickname", error: null, busy: false });
  });

  it("join menyimpan token per PIN dan menampilkan lobby", () => {
    const { player, last } = session();
    player.start();
    player.join("Dimas");
    const ws = fakes.latest();
    ws.serverOpen();
    expect(ws.sentMessages()).toEqual([{ t: "join", v: 1, nickname: "Dimas" }]);
    ws.serverSend(welcome({ sessionToken: TOKEN }));
    expect(fakes.storage.get(`sorak:session:${PIN}`)).toBe(TOKEN);
    expect(last()).toEqual({ kind: "lobby", me: { playerId: "p1", nickname: "Dimas" }, playerCount: 4 });
    ws.serverSend({ t: "lobby", playerCount: 5 });
    expect(last()).toEqual({ kind: "lobby", me: { playerId: "p1", nickname: "Dimas" }, playerCount: 5 });
  });

  it("NICKNAME_TAKEN tampil di form, nama berikutnya dikirim lewat socket yang sama", () => {
    const { player, last } = session();
    player.join("Dimas");
    const ws = fakes.latest();
    ws.serverOpen();
    ws.serverSend({ t: "error", code: "NICKNAME_TAKEN", message: "x" });
    expect(last()).toMatchObject({ kind: "nickname", error: expect.stringContaining("sudah dipakai"), busy: false });
    player.join("Dimas 2");
    expect(fakes.latest()).toBe(ws);
    expect(ws.sentMessages().at(-1)).toEqual({ t: "join", v: 1, nickname: "Dimas 2" });
  });

  it("dengan token tersimpan, start langsung resume", () => {
    fakes.storage.set(`sorak:session:${PIN}`, TOKEN);
    const { player, last } = session();
    player.start();
    expect(last()).toEqual({ kind: "connecting" });
    fakes.latest().serverOpen();
    expect(fakes.latest().sentMessages()).toEqual([{ t: "resume", v: 1, sessionToken: TOKEN }]);
  });

  it("Masuk lagi: token ditolak (4003) -> token dibuang lalu join ulang dengan nickname yang sama", () => {
    const { player, last } = session();
    player.join("Dimas");
    const first = fakes.latest();
    first.serverOpen();
    first.serverSend(welcome({ sessionToken: TOKEN }));
    first.serverClose(CloseCode.ABNORMAL);
    expect(last()).toEqual({ kind: "ended", message: "Koneksi terputus.", canRetry: true });

    player.retry();
    const resumed = fakes.latest();
    resumed.serverOpen();
    expect(resumed.sentMessages()).toEqual([{ t: "resume", v: 1, sessionToken: TOKEN }]);
    resumed.serverSend({ t: "error", code: "SESSION_INVALID", message: "x" });
    resumed.serverClose(CloseCode.SESSION_INVALID);
    expect(fakes.storage.has(`sorak:session:${PIN}`)).toBe(false);

    const rejoined = fakes.latest();
    expect(rejoined).not.toBe(resumed);
    rejoined.serverOpen();
    expect(rejoined.sentMessages()).toEqual([{ t: "join", v: 1, nickname: "Dimas" }]);
  });

  it("answer mengirim jawaban sekali dengan elapsedMs, lalu menunggu konfirmasi", () => {
    const { player, last } = session();
    player.join("Dimas");
    const ws = fakes.latest();
    ws.serverOpen();
    ws.serverSend(welcome({ sessionToken: TOKEN }));
    ws.serverSend({ t: "question", q: 0, total: 3, prompt: "1 + 1?", options: ["1", "2"], durationMs: 20_000, imageUrl: null });
    player.answer(1);
    player.answer(0);
    const answers = ws.sentMessages().filter((message) => (message as { t: string }).t === "answer");
    expect(answers).toEqual([{ t: "answer", q: 0, choice: 1, elapsedMs: expect.any(Number) }]);
    expect(last()).toMatchObject({ kind: "question", choice: 1, confirmed: false });
    ws.serverSend({ t: "answer_received", q: 0 });
    expect(last()).toMatchObject({ kind: "question", choice: 1, confirmed: true });
  });

  it("room ditutup guru -> layar akhir tanpa Masuk lagi", () => {
    const { player, last } = session();
    player.join("Dimas");
    fakes.latest().serverOpen();
    fakes.latest().serverClose(CloseCode.ROOM_CLOSED);
    expect(last()).toEqual({ kind: "ended", message: "Room ditutup oleh guru.", canRetry: false });
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
    const { player, last } = session();
    player.start();
    player.join("Dimas");
    fakes.latest().serverOpen();
    fakes.latest().serverSend(welcome({ sessionToken: TOKEN }));
    expect(last()).toMatchObject({ kind: "lobby" });
  });
});
