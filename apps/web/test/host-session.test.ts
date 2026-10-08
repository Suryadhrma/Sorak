import { CloseCode } from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostSession, type HostView } from "../src/host-session.ts";
import { installBrowserFakes } from "./fake-websocket.ts";

describe("host session", () => {
  let fakes: ReturnType<typeof installBrowserFakes>;

  beforeEach(() => {
    fakes = installBrowserFakes();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function session() {
    const views: HostView[] = [];
    const host = createHostSession("123456", (view) => views.push(view));
    return { host, last: () => views.at(-1) };
  }

  it("connect mengirim host_hello dan menampilkan lobby dari host_welcome", () => {
    const { host, last } = session();
    host.connect();
    const ws = fakes.latest();
    expect(ws.url).toBe("wss://sorak.test/ws/host/123456");
    ws.serverOpen();
    expect(ws.sentMessages()).toEqual([{ t: "host_hello", v: 1 }]);
    ws.serverSend({
      t: "host_welcome",
      v: 1,
      room: { pin: "123456", scoringMode: "classic", teamMode: false, questionCount: 3 },
      phase: "lobby",
      players: [],
      question: null,
      remainingMs: null,
      answered: 0,
    });
    expect(last()).toMatchObject({ kind: "lobby", base: { players: [] } });
  });

  it("aksi guru dikirim sebagai pesan start, next, dan end", () => {
    const { host } = session();
    host.connect();
    fakes.latest().serverOpen();
    host.startGame();
    host.next();
    host.end();
    expect(fakes.latest().sentMessages().slice(1)).toEqual([{ t: "start" }, { t: "next" }, { t: "end" }]);
  });

  it("room bukan milik host -> layar akhir tanpa Sambung lagi", () => {
    const { host, last } = session();
    host.connect();
    fakes.latest().serverClose(CloseCode.ROOM_NOT_FOUND);
    expect(last()).toMatchObject({ kind: "closed", canRetry: false });
  });

  it("koneksi putus -> boleh sambung lagi", () => {
    const { host, last } = session();
    host.connect();
    fakes.latest().serverOpen();
    fakes.latest().serverClose(CloseCode.ABNORMAL);
    expect(last()).toEqual({ kind: "closed", message: "Koneksi terputus.", canRetry: true });
  });
});
