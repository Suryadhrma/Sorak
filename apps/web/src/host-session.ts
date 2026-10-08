import { PROTOCOL_VERSION, decodeHostServerMessage, type HostServerMessage, type Pin } from "@sorak/shared";
import { hostScreen, type HostEvent, type HostView } from "./host-screen.ts";
import { openRoomSocket, type RoomSocket } from "./socket.ts";

/** Koneksi layar proyektor: meneruskan setiap kejadian ke reducer layar (host-screen.ts) dan mengirim aksi guru. */

export type { HostView } from "./host-screen.ts";

export type HostSession = {
  /** Juga dipakai untuk "Sambung lagi": host_welcome membawa keadaan room lengkap. */
  connect(): void;
  startGame(): void;
  next(): void;
  /** Di lobby membatalkan room; di tengah game mengakhiri game dan menampilkan podium. */
  end(): void;
  stop(): void;
};

export function createHostSession(pin: Pin, onView: (view: HostView) => void): HostSession {
  let view: HostView = { kind: "connecting" };
  let socket: RoomSocket | null = null;

  const show = (next: HostView) => {
    view = next;
    onView(next);
  };
  const dispatch = (event: HostEvent) => show(hostScreen(view, event));

  return {
    connect() {
      show({ kind: "connecting" });
      socket = openRoomSocket({
        path: `/ws/host/${pin}`,
        opening: { t: "host_hello", v: PROTOCOL_VERSION },
        decode: decodeHostServerMessage,
        onMessage: (message: HostServerMessage) => dispatch({ type: "server", message, at: performance.now() }),
        onClose: (code) => {
          socket = null;
          dispatch({ type: "closed", code });
        },
      });
    },
    startGame: () => socket?.send({ t: "start" }),
    next: () => socket?.send({ t: "next" }),
    end: () => socket?.send({ t: "end" }),
    stop() {
      socket?.close();
      socket = null;
    },
  };
}
