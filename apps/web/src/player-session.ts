import {
  CloseCode,
  PROTOCOL_VERSION,
  decodePlayerServerMessage,
  type PlayerMessage,
  type PlayerServerMessage,
  type Pin,
} from "@sorak/shared";
import { closeMessage, openRoomSocket, type RoomSocket } from "./socket.ts";

/**
 * Alur pemain di lobby: join dengan nickname, atau resume dengan token yang tersimpan.
 * Komponen hanya menampilkan `PlayerView` dan memanggil aksi; semua keputusan koneksi ada di sini.
 */

export type PlayerView =
  | { kind: "nickname"; error: string | null; busy: boolean }
  | { kind: "connecting" }
  | { kind: "lobby"; nickname: string; playerCount: number }
  | { kind: "ended"; message: string; canRetry: boolean };

export type PlayerSession = {
  /** Resume otomatis kalau HP ini pernah masuk ke PIN yang sama (misalnya halaman dimuat ulang). */
  start(): void;
  join(nickname: string): void;
  /** "Masuk lagi": resume dulu supaya tidak ada nama ganda, join ulang kalau token ditolak. */
  retry(): void;
  stop(): void;
};

const NICKNAME_ERRORS = {
  NICKNAME_TAKEN: "Nickname sudah dipakai pemain lain. Coba nama lain.",
  NICKNAME_INVALID: "Nickname hanya boleh huruf, angka, spasi, titik, _ dan -.",
} as const;

const tokenKey = (pin: Pin) => `sorak:session:${pin}`;

// localStorage bisa dilempar (mode privat, penyimpanan diblokir). Tanpa token, pemain tetap bisa join;
// yang hilang hanya kemampuan resume.
function loadToken(pin: Pin): string | null {
  try {
    return localStorage.getItem(tokenKey(pin));
  } catch {
    return null;
  }
}

function saveToken(pin: Pin, token: string): void {
  try {
    localStorage.setItem(tokenKey(pin), token);
  } catch {
    return;
  }
}

function forgetToken(pin: Pin): void {
  try {
    localStorage.removeItem(tokenKey(pin));
  } catch {
    return;
  }
}

export function createPlayerSession(pin: Pin, onView: (view: PlayerView) => void): PlayerSession {
  let socket: RoomSocket | null = null;
  let nickname: string | null = null;
  let welcomed = false;

  const joinMessage = (name: string): PlayerMessage => ({ t: "join", v: PROTOCOL_VERSION, nickname: name });

  function connect(opening: PlayerMessage): void {
    welcomed = false;
    socket = openRoomSocket({ path: `/ws/play/${pin}`, opening, decode: decodePlayerServerMessage, onMessage, onClose });
  }

  /** Resume kalau ada token, join kalau nickname sudah diketahui, selain itu tanya nickname. */
  function reconnect(): void {
    const token = loadToken(pin);
    if (token) {
      onView({ kind: "connecting" });
      return connect({ t: "resume", v: PROTOCOL_VERSION, sessionToken: token });
    }
    if (nickname) {
      onView({ kind: "connecting" });
      return connect(joinMessage(nickname));
    }
    onView({ kind: "nickname", error: null, busy: false });
  }

  function onMessage(message: PlayerServerMessage): void {
    switch (message.t) {
      case "welcome":
        welcomed = true;
        nickname = message.nickname;
        if (message.sessionToken) saveToken(pin, message.sessionToken);
        return onView({ kind: "lobby", nickname: message.nickname, playerCount: message.snapshot.playerCount });
      case "lobby":
        if (welcomed && nickname) onView({ kind: "lobby", nickname, playerCount: message.playerCount });
        return;
      case "error":
        // Error nickname tidak memutus koneksi; error lain selalu diikuti close, dan teksnya dari close code.
        if (message.code === "NICKNAME_TAKEN" || message.code === "NICKNAME_INVALID") {
          onView({ kind: "nickname", error: NICKNAME_ERRORS[message.code], busy: false });
        }
        return;
      default:
        // Soal, hasil, dan skor ditangani mulai Hari 3.
        return;
    }
  }

  function onClose(code: number): void {
    socket = null;
    if (code === CloseCode.SESSION_INVALID) {
      forgetToken(pin);
      return reconnect();
    }
    onView({ kind: "ended", ...closeMessage(code) });
  }

  return {
    start: reconnect,
    join(name) {
      nickname = name;
      onView({ kind: "nickname", error: null, busy: true });
      // Setelah NICKNAME_TAKEN socket masih terbuka dan belum join, jadi nama baru dikirim lewat socket yang sama.
      if (socket && !welcomed) return socket.send(joinMessage(name));
      connect(joinMessage(name));
    },
    retry: reconnect,
    stop() {
      socket?.close();
      socket = null;
    },
  };
}
