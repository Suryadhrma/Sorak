import { CloseCode, type RosterEntry } from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRosterMessage, createHostSession, type HostView } from "../src/host-session.ts";
import { installBrowserFakes } from "./fake-websocket.ts";

const andi: RosterEntry = { playerId: "p1", nickname: "Andi", teamSize: null, connected: true };
const budi: RosterEntry = { playerId: "p2", nickname: "Budi", teamSize: null, connected: true };

describe("applyRosterMessage", () => {
  it("player_joined menambah, dan pemain yang sama tidak pernah ganda", () => {
    const once = applyRosterMessage([andi], { t: "player_joined", player: budi, playerCount: 2 });
    expect(once).toEqual([andi, budi]);
    expect(applyRosterMessage(once, { t: "player_joined", player: budi, playerCount: 2 })).toEqual([andi, budi]);
  });

  it("player_left membuang pemain itu", () => {
    expect(applyRosterMessage([andi, budi], { t: "player_left", playerId: "p1", kicked: false, playerCount: 1 })).toEqual([budi]);
  });

  it("pesan lain tidak mengubah daftar", () => {
    expect(applyRosterMessage([andi], { t: "reaction", reaction: "fire" })).toEqual([andi]);
  });
});

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

  it("host_hello lalu daftar pemain dari host_welcome dan delta", () => {
    const { host, last } = session();
    host.start();
    const ws = fakes.latest();
    expect(ws.url).toBe("wss://sorak.test/ws/host/123456");
    ws.serverOpen();
    expect(ws.sentMessages()).toEqual([{ t: "host_hello", v: 1 }]);
    ws.serverSend({
      t: "host_welcome",
      v: 1,
      room: { pin: "123456", scoringMode: "classic", teamMode: false, questionCount: 3 },
      phase: "lobby",
      players: [andi],
      question: null,
      remainingMs: null,
      answered: 0,
    });
    ws.serverSend({ t: "player_joined", player: budi, playerCount: 2 });
    expect(last()).toEqual({ kind: "lobby", players: [andi, budi] });
  });

  it("end mengirim pesan end", () => {
    const { host } = session();
    host.start();
    fakes.latest().serverOpen();
    host.end();
    expect(fakes.latest().sentMessages().at(-1)).toEqual({ t: "end" });
  });

  it("room bukan milik host -> layar akhir tanpa Sambung lagi", () => {
    const { host, last } = session();
    host.start();
    fakes.latest().serverClose(CloseCode.ROOM_NOT_FOUND);
    expect(last()).toMatchObject({ kind: "ended", canRetry: false });
  });

  it("koneksi putus -> boleh sambung lagi", () => {
    const { host, last } = session();
    host.start();
    fakes.latest().serverOpen();
    fakes.latest().serverClose(CloseCode.ABNORMAL);
    expect(last()).toEqual({ kind: "ended", message: "Koneksi terputus.", canRetry: true });
  });
});
