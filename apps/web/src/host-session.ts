import { PROTOCOL_VERSION, decodeHostServerMessage, type HostServerMessage, type Pin } from "@sorak/shared";
import { hostScreen, type HostEvent, type HostView } from "./host-screen.ts";
import { connectRoom, type ConnectionStatus, type RoomConnection } from "./socket.ts";

/**
 * Koneksi layar proyektor: tersambung ulang sendiri (host_welcome membawa keadaan room lengkap), meneruskan
 * setiap kejadian ke reducer layar (host-screen.ts), dan mengirim aksi guru.
 */

export type { HostView } from "./host-screen.ts";

export type HostSession = {
  connect(): void;
  startGame(): void;
  next(): void;
  /** Di lobby membatalkan room; di tengah game mengakhiri game dan menampilkan podium. */
  end(): void;
  kick(playerId: string): void;
  stop(): void;
};

export function createHostSession(
  pin: Pin,
  onView: (view: HostView) => void,
  onStatus: (status: ConnectionStatus) => void,
): HostSession {
  let view: HostView = { kind: "connecting" };
  let connection: RoomConnection | null = null;

  const show = (next: HostView) => {
    view = next;
    onView(next);
  };
  const dispatch = (event: HostEvent) => show(hostScreen(view, event));

  function onMessage(message: HostServerMessage): void {
    if (message.t === "host_welcome") connection?.markHealthy();
    dispatch({ type: "server", message, at: performance.now() });
  }

  return {
    connect() {
      show({ kind: "connecting" });
      connection = connectRoom({
        path: `/ws/host/${pin}`,
        opening: () => ({ t: "host_hello", v: PROTOCOL_VERSION }),
        decode: decodeHostServerMessage,
        onMessage,
        onStatus,
        onEnd: (code) => {
          connection = null;
          dispatch({ type: "closed", code });
        },
      });
    },
    startGame: () => void connection?.send({ t: "start" }),
    next: () => void connection?.send({ t: "next" }),
    end: () => void connection?.send({ t: "end" }),
    kick: (playerId) => void connection?.send({ t: "kick", playerId }),
    stop() {
      connection?.close();
      connection = null;
    },
  };
}
