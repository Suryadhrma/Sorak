import {
  CloseCode,
  PROTOCOL_VERSION,
  decodeHostServerMessage,
  type HostServerMessage,
  type Pin,
  type RosterEntry,
} from "@sorak/shared";
import { closeMessage, openRoomSocket, type RoomSocket } from "./socket.ts";

/** Alur layar proyektor di lobby: daftar pemain dari snapshot host_welcome, lalu diperbarui per delta. */

export type HostView =
  | { kind: "connecting" }
  | { kind: "lobby"; players: RosterEntry[] }
  | { kind: "ended"; message: string; canRetry: boolean };

export type HostSession = {
  /** Juga dipakai untuk "Sambung lagi": host_welcome membawa daftar pemain lengkap. */
  start(): void;
  /** Membatalkan room: semua pemain keluar dan PIN bebas lagi. */
  end(): void;
  stop(): void;
};

export function applyRosterMessage(players: RosterEntry[], message: HostServerMessage): RosterEntry[] {
  switch (message.t) {
    case "host_welcome":
      return message.players;
    case "player_joined":
      // Pemain yang sama bisa muncul lagi (misalnya setelah resume); jangan sampai namanya ganda.
      return [...players.filter((player) => player.playerId !== message.player.playerId), message.player];
    case "player_left":
      return players.filter((player) => player.playerId !== message.playerId);
    default:
      return players;
  }
}

export function createHostSession(pin: Pin, onView: (view: HostView) => void): HostSession {
  let socket: RoomSocket | null = null;
  let players: RosterEntry[] = [];

  function onMessage(message: HostServerMessage): void {
    players = applyRosterMessage(players, message);
    onView({ kind: "lobby", players });
  }

  function onClose(code: number): void {
    socket = null;
    if (code === CloseCode.ROOM_NOT_FOUND) {
      return onView({ kind: "ended", message: "Room tidak ditemukan, atau bukan milik akun ini.", canRetry: false });
    }
    if (code === CloseCode.ROOM_CLOSED) return onView({ kind: "ended", message: "Room sudah ditutup.", canRetry: false });
    onView({ kind: "ended", ...closeMessage(code) });
  }

  return {
    start() {
      onView({ kind: "connecting" });
      socket = openRoomSocket({
        path: `/ws/host/${pin}`,
        opening: { t: "host_hello", v: PROTOCOL_VERSION },
        decode: decodeHostServerMessage,
        onMessage,
        onClose,
      });
    },
    end() {
      socket?.send({ t: "end" });
    },
    stop() {
      socket?.close();
      socket = null;
    },
  };
}
