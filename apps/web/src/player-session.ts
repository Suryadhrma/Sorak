import {
  CloseCode,
  PROTOCOL_VERSION,
  TIME_LIMIT_MAX_SEC,
  decodePlayerServerMessage,
  type PlayerMessage,
  type PlayerServerMessage,
  type Pin,
} from "@sorak/shared";
import { clearQueuedAnswer, decideQueuedAnswer, loadQueuedAnswer, saveQueuedAnswer, type QueuedAnswer } from "./outbox.ts";
import { initialPlayerScreen, playerScreen, type PlayerEvent, type PlayerScreen } from "./player-screen.ts";
import { connectRoom, type ConnectionStatus, type RoomConnection } from "./socket.ts";

/**
 * Koneksi pemain: join atau resume, ack setiap soal, dan antrean jawaban yang tahan sinyal putus.
 * Setiap kejadian diteruskan ke reducer layar (player-screen.ts); komponen hanya menampilkan dan memanggil aksi.
 */

export type { PlayerView } from "./player-screen.ts";

export type PlayerSession = {
  /** Resume otomatis kalau HP ini pernah masuk ke PIN yang sama (misalnya halaman dimuat ulang). */
  start(): void;
  join(nickname: string): void;
  answer(choice: number): void;
  /** "Pakai di sini": ambil alih dari tab atau HP lain (resume dengan token yang sama). */
  takeOver(): void;
  /** "Sambung sekarang": tidak menunggu sisa jeda reconnect. */
  retryNow(): void;
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

export function createPlayerSession(
  pin: Pin,
  onScreen: (screen: PlayerScreen) => void,
  onStatus: (status: ConnectionStatus) => void,
): PlayerSession {
  let screen: PlayerScreen = initialPlayerScreen;
  let connection: RoomConnection | null = null;
  let nickname: string | null = null;
  let queued: QueuedAnswer | null = loadQueuedAnswer(pin);

  const show = (next: PlayerScreen) => {
    screen = next;
    onScreen(next);
  };
  const dispatch = (event: PlayerEvent) => show(playerScreen(screen, event));
  const joinMessage = (name: string): PlayerMessage => ({ t: "join", v: PROTOCOL_VERSION, nickname: name });

  function forgetQueue(): void {
    queued = null;
    clearQueuedAnswer(pin);
  }

  function sendAnswer(answer: QueuedAnswer): void {
    connection?.send({ t: "answer", q: answer.q, choice: answer.choice, elapsedMs: answer.elapsedMs });
  }

  /** Setiap kali tersambung (termasuk setelah reconnect): resume kalau ada token, join kalau belum. */
  function opening(): PlayerMessage {
    const token = loadToken(pin);
    if (token) return { t: "resume", v: PROTOCOL_VERSION, sessionToken: token };
    return joinMessage(nickname ?? "");
  }

  function connect(): void {
    connection = connectRoom({
      path: `/ws/play/${pin}`,
      opening,
      decode: decodePlayerServerMessage,
      onMessage,
      onStatus,
      onEnd,
    });
  }

  function onMessage(message: PlayerServerMessage): void {
    const at = performance.now();
    switch (message.t) {
      case "welcome":
        nickname = message.nickname;
        if (message.sessionToken) saveToken(pin, message.sessionToken);
        connection?.markHealthy();
        dispatch({ type: "server", message, at });
        resolveQueue(message.snapshot);
        return;
      case "question":
        // ack sebelum render: server memakainya untuk mengukur jeda sinyal HP ini.
        connection?.send({ t: "ack", q: message.q });
        if (queued && queued.q !== message.q) forgetQueue();
        dispatch({ type: "server", message, at });
        return;
      case "answer_received":
        if (queued?.q === message.q) forgetQueue();
        dispatch({ type: "server", message, at });
        return;
      default:
        dispatch({ type: "server", message, at });
    }
  }

  /** Setelah welcome: kirim ulang jawaban yang tertahan kalau soalnya masih aktif dan server belum punya. */
  function resolveQueue(snapshot: Extract<PlayerServerMessage, { t: "welcome" }>["snapshot"]): void {
    if (!queued) return;
    if (decideQueuedAnswer(snapshot, queued) === "drop") return forgetQueue();
    sendAnswer(queued);
    dispatch({ type: "answer_sent", choice: queued.choice });
  }

  function onEnd(code: number): void {
    connection = null;
    if (code === CloseCode.SESSION_INVALID || code === CloseCode.KICKED) {
      forgetToken(pin);
      forgetQueue();
    }
    dispatch({ type: "ended", code });
  }

  return {
    start() {
      if (loadToken(pin)) {
        show({ ...screen, view: { kind: "connecting" } });
        return connect();
      }
      show({ ...screen, view: { kind: "nickname", error: null, busy: false } });
    },
    join(name) {
      nickname = name;
      show({ ...screen, view: { kind: "nickname", error: null, busy: true } });
      // Setelah NICKNAME_TAKEN socket masih terbuka dan belum join: nama baru dikirim lewat socket yang sama.
      // Kalau sedang menunggu reconnect, pesan pembukanya nanti memakai nama baru ini.
      if (connection) return void connection.send(joinMessage(name));
      connect();
    },
    answer(choice) {
      const { view } = screen;
      if (view.kind !== "question" || view.choice !== null || view.confirmed) return;
      // Lama berpikir sejak soal pertama kali tampil di HP ini, dihitung saat ditekan (bukan saat terkirim).
      const remainingAtPress = view.durationMs - (performance.now() - view.startedAt);
      const elapsedMs = Math.round(view.question.durationMs - remainingAtPress);
      queued = { q: view.question.q, choice, elapsedMs: Math.min(Math.max(elapsedMs, 0), TIME_LIMIT_MAX_SEC * 1000) };
      saveQueuedAnswer(pin, queued);
      sendAnswer(queued);
      dispatch({ type: "answer_sent", choice });
    },
    takeOver() {
      show({ ...screen, view: { kind: "connecting" } });
      connect();
    },
    retryNow() {
      connection?.retryNow();
    },
    stop() {
      connection?.close();
      connection = null;
    },
  };
}
