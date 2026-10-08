import { CloseCode, HEARTBEAT, encodeClientMessage, shouldReconnect, type ClientMessage, type DecodeResult } from "@sorak/shared";

/**
 * Transport WebSocket bersama untuk layar pemain dan layar host. Komponen tidak menyentuh WebSocket langsung.
 * Reconnect otomatis dengan backoff dikerjakan Hari 4; hari ini penutupan dilaporkan dan pengguna memilih
 * "Masuk lagi".
 */

export type RoomSocket = { send(message: ClientMessage): void; close(): void };

export type RoomSocketOptions<T> = {
  /** Misalnya `/ws/play/123456`; host diambil dari halaman, jadi lewat proxy Vite di dev dan domain yang sama di produksi. */
  path: string;
  /** Pesan pertama begitu tersambung: join, resume, atau host_hello. */
  opening: ClientMessage;
  decode: (raw: unknown) => DecodeResult<T>;
  onMessage: (message: T) => void;
  /** Dipanggil sekali saat koneksi berakhir bukan karena close() dari kita. */
  onClose: (code: number) => void;
};

export function openRoomSocket<T>(options: RoomSocketOptions<T>): RoomSocket {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${scheme}//${location.host}${options.path}`);
  let finished = false;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimers = () => {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
  };
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    stopTimers();
    options.onClose(code);
  };

  ws.addEventListener("open", () => {
    ws.send(encodeClientMessage(options.opening));
    pingTimer = setInterval(() => {
      ws.send(HEARTBEAT.request);
      // HP yang hilang sinyal sering tidak pernah menerima close; pong yang tidak datang adalah satu-satunya tanda.
      pongTimer ??= setTimeout(() => {
        ws.close();
        finish(CloseCode.ABNORMAL);
      }, HEARTBEAT.timeoutMs);
    }, HEARTBEAT.intervalMs);
  });

  ws.addEventListener("message", (event) => {
    if (event.data === HEARTBEAT.response) {
      clearTimeout(pongTimer);
      pongTimer = undefined;
      return;
    }
    const decoded = options.decode(event.data);
    // Jenis pesan yang belum dikenal versi web ini diabaikan, supaya server bisa menambah pesan baru.
    if (decoded.ok) options.onMessage(decoded.data);
  });

  ws.addEventListener("close", (event) => finish(event.code));

  return {
    send(message) {
      if (ws.readyState === WebSocket.OPEN) ws.send(encodeClientMessage(message));
    },
    close() {
      finished = true;
      stopTimers();
      ws.close(CloseCode.NORMAL);
    },
  };
}

const CLOSE_MESSAGES: Partial<Record<number, string>> = {
  [CloseCode.ROOM_CLOSED]: "Room ditutup oleh guru.",
  [CloseCode.KICKED]: "Kamu dikeluarkan oleh guru.",
  [CloseCode.REPLACED]: "Kamu tersambung dari tab atau HP lain.",
  [CloseCode.ROOM_NOT_FOUND]: "Room tidak ditemukan. Periksa lagi PIN-nya.",
  [CloseCode.UNSUPPORTED_VERSION]: "Sorak baru saja diperbarui. Muat ulang halaman.",
  [CloseCode.TOO_MANY_INVALID]: "Koneksi ditutup karena terjadi kesalahan. Muat ulang halaman.",
  [CloseCode.ROOM_FULL]: "Room sudah penuh.",
  [CloseCode.GAME_ALREADY_STARTED]: "Permainan sudah dimulai.",
};

/** Teks untuk layar setelah koneksi berakhir, dan apakah tombol "Masuk lagi" masuk akal. */
export function closeMessage(code: number): { message: string; canRetry: boolean } {
  const canRetry = shouldReconnect(code);
  const message = CLOSE_MESSAGES[code] ?? (canRetry ? "Koneksi terputus." : "Koneksi ditutup.");
  return { message, canRetry };
}
