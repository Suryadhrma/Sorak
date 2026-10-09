import { CloseCode } from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostSession, type HostView } from "../src/host-session.ts";
import type { ConnectionStatus } from "../src/socket.ts";
import { installBrowserFakes } from "./fake-websocket.ts";

const hostWelcome = {
  t: "host_welcome",
  v: 1,
  room: { pin: "123456", scoringMode: "classic", teamMode: false, questionCount: 3 },
  phase: "lobby",
  players: [],
  question: null,
  remainingMs: null,
  answered: 0,
};

describe("host session", () => {
  let fakes: ReturnType<typeof installBrowserFakes>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakes = installBrowserFakes();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function session() {
    const views: HostView[] = [];
    const statuses: ConnectionStatus[] = [];
    const host = createHostSession(
      "123456",
      (view) => views.push(view),
      (status) => statuses.push(status),
    );
    return { host, last: () => views.at(-1), status: () => statuses.at(-1) };
  }

  it("connect mengirim host_hello dan menampilkan lobby dari host_welcome", () => {
    const { host, last } = session();
    host.connect();
    const ws = fakes.latest();
    expect(ws.url).toBe("wss://sorak.test/ws/host/123456");
    ws.serverOpen();
    expect(ws.sentMessages()).toEqual([{ t: "host_hello", v: 1 }]);
    ws.serverSend(hostWelcome);
    expect(last()).toMatchObject({ kind: "lobby", base: { players: [] } });
  });

  it("aksi guru dikirim sebagai pesan start, next, end, dan kick", () => {
    const { host } = session();
    host.connect();
    fakes.latest().serverOpen();
    host.startGame();
    host.next();
    host.end();
    host.kick("p7");
    expect(fakes.latest().sentMessages().slice(1)).toEqual([{ t: "start" }, { t: "next" }, { t: "end" }, { t: "kick", playerId: "p7" }]);
  });

  it("room bukan milik host -> layar tertutup, tidak reconnect", () => {
    const { host, last } = session();
    host.connect();
    const ws = fakes.latest();
    ws.serverClose(CloseCode.ROOM_NOT_FOUND);
    vi.advanceTimersByTime(60_000);
    expect(fakes.latest()).toBe(ws);
    expect(last()).toEqual({ kind: "closed", message: "Room tidak ditemukan, atau bukan milik akun ini." });
  });

  it("koneksi putus -> layar tetap, menyambung lagi sendiri dan mengirim host_hello lagi", () => {
    const { host, last, status } = session();
    host.connect();
    const first = fakes.latest();
    first.serverOpen();
    first.serverSend(hostWelcome);
    first.serverClose(CloseCode.ABNORMAL);
    expect(status()).toMatchObject({ kind: "waiting", attempt: 1 });
    expect(last()).toMatchObject({ kind: "lobby" });

    vi.runOnlyPendingTimers();
    const second = fakes.latest();
    expect(second).not.toBe(first);
    second.serverOpen();
    expect(second.sentMessages()).toEqual([{ t: "host_hello", v: 1 }]);
    expect(status()).toEqual({ kind: "open" });
  });
});
