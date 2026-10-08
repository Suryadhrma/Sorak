import {
  CloseCode,
  PROTOCOL_VERSION,
  TIME_LIMIT_MAX_SEC,
  decodePlayerServerMessage,
  type PlayerMessage,
  type PlayerServerMessage,
  type Pin,
} from "@sorak/shared";
import { playerScreen, type PlayerEvent, type PlayerView } from "./player-screen.ts";
import { openRoomSocket, type RoomSocket } from "./socket.ts";

/**
 * Koneksi pemain: join dengan nickname atau resume dengan token tersimpan, lalu meneruskan setiap kejadian
 * ke reducer layar (player-screen.ts). Komponen hanya menampilkan `PlayerView` dan memanggil aksi.
 */

export type { PlayerView } from "./player-screen.ts";

export type PlayerSession = {
  /** Resume otomatis kalau HP ini pernah masuk ke PIN yang sama (misalnya halaman dimuat ulang). */
  start(): void;
  join(nickname: string): void;
  answer(choice: number): void;
  /** "Masuk lagi": resume dulu supaya tidak ada nama ganda, join ulang kalau token ditolak. */
  retry(): void;
  stop(): void;
};

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
  let view: PlayerView = { kind: "connecting" };
  let socket: RoomSocket | null = null;
  let nickname: string | null = null;

  const show = (next: PlayerView) => {
    view = next;
    onView(next);
  };
  const dispatch = (event: PlayerEvent) => show(playerScreen(view, event));
  const joinMessage = (name: string): PlayerMessage => ({ t: "join", v: PROTOCOL_VERSION, nickname: name });

  function connect(opening: PlayerMessage): void {
    socket = openRoomSocket({ path: `/ws/play/${pin}`, opening, decode: decodePlayerServerMessage, onMessage, onClose });
  }

  /** Resume kalau ada token, join kalau nickname sudah diketahui, selain itu tanya nickname. */
  function reconnect(): void {
    const token = loadToken(pin);
    if (token) {
      show({ kind: "connecting" });
      return connect({ t: "resume", v: PROTOCOL_VERSION, sessionToken: token });
    }
    if (nickname) {
      show({ kind: "connecting" });
      return connect(joinMessage(nickname));
    }
    show({ kind: "nickname", error: null, busy: false });
  }

  function onMessage(message: PlayerServerMessage): void {
    if (message.t === "welcome") {
      nickname = message.nickname;
      if (message.sessionToken) saveToken(pin, message.sessionToken);
    }
    dispatch({ type: "server", message, at: performance.now() });
  }

  function onClose(code: number): void {
    socket = null;
    if (code === CloseCode.SESSION_INVALID) {
      forgetToken(pin);
      return reconnect();
    }
    dispatch({ type: "closed", code });
  }

  return {
    start: reconnect,
    join(name) {
      nickname = name;
      const reuse = socket !== null && view.kind === "nickname";
      show({ kind: "nickname", error: null, busy: true });
      // Setelah NICKNAME_TAKEN socket masih terbuka dan belum join, jadi nama baru dikirim lewat socket yang sama.
      if (reuse && socket) return socket.send(joinMessage(name));
      connect(joinMessage(name));
    },
    answer(choice) {
      if (view.kind !== "question" || view.choice !== null || !socket) return;
      // Lama berpikir menurut HP; server belum memakainya sampai kompensasi latency Hari 4.
      const elapsedMs = Math.min(Math.max(Math.round(performance.now() - view.startedAt), 0), TIME_LIMIT_MAX_SEC * 1000);
      socket.send({ t: "answer", q: view.question.q, choice, elapsedMs });
      dispatch({ type: "answer_sent", choice });
    },
    retry: reconnect,
    stop() {
      socket?.close();
      socket = null;
    },
  };
}
