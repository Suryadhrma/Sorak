import {
  CloseCode,
  HEARTBEAT,
  RECONNECT_BACKOFF_MS,
  RECONNECT_JITTER_RATIO,
  encodeClientMessage,
  shouldReconnect,
  type ClientMessage,
  type DecodeResult,
} from "@sorak/shared";

/**
 * Koneksi WebSocket bersama untuk layar pemain dan layar host: sambung, heartbeat, dan sambung ulang otomatis.
 * Komponen tidak menyentuh WebSocket langsung; mereka hanya membaca status dan pesan dari sesi.
 */

/** "waiting": menunggu percobaan berikutnya; since + delayMs = kapan percobaan itu (jam performance.now). */
export type ConnectionStatus =
  | { kind: "connecting"; attempt: number }
  | { kind: "open" }
  | { kind: "waiting"; attempt: number; since: number; delayMs: number };

export type RoomConnection = {
  /** false kalau socket sedang tidak terbuka (pesan tidak terkirim). */
  send(message: ClientMessage): boolean;
  /** Coba sekarang tanpa menunggu jeda, misalnya saat pemain menekan "Sambung sekarang". */
  retryNow(): void;
  /** Dipanggil sesi setelah welcome: jeda reconnect berikutnya kembali dari yang terpendek. */
  markHealthy(): void;
  close(): void;
};

export type RoomConnectionOptions<T> = {
  /** Misalnya `/ws/play/123456`; host diambil dari halaman, jadi lewat proxy Vite di dev dan domain yang sama di produksi. */
  path: string;
  /** Pesan pertama setiap kali tersambung (termasuk setelah reconnect): resume, join, atau host_hello. */
  opening: () => ClientMessage;
  decode: (raw: unknown) => DecodeResult<T>;
  onMessage: (message: T) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** Penutupan yang memang tidak boleh di-reconnect (keputusan server, misalnya 4001 dikeluarkan). */
  onEnd: (code: number) => void;
};

/**
 * Jeda sebelum percobaan ke-(attempt + 1): jeda dasar bertahap (exponential backoff) ditambah acak 0..50%
 * (jitter). Tanpa jitter, ratusan HP yang WiFi-nya pulih bersamaan menyambung di milidetik yang sama
 * (thundering herd). `random` di rentang [0, 1).
 */
export function reconnectDelay(attempt: number, random: number): number {
  const steps = RECONNECT_BACKOFF_MS;
  const base = steps[Math.min(attempt, steps.length - 1)] ?? steps[steps.length - 1] ?? 0;
  return base + random * base * RECONNECT_JITTER_RATIO;
}

export function connectRoom<T>(options: RoomConnectionOptions<T>): RoomConnection {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;

  const stopHeartbeat = () => {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    pongTimer = undefined;
  };

  function open(): void {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    options.onStatus({ kind: "connecting", attempt });
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}${options.path}`);
    ws = socket;

    socket.addEventListener("open", () => {
      if (ws !== socket) return;
      options.onStatus({ kind: "open" });
      socket.send(encodeClientMessage(options.opening()));
      pingTimer = setInterval(() => {
        socket.send(HEARTBEAT.request);
        // HP yang hilang sinyal sering tidak pernah menerima close; pong yang tidak datang adalah satu-satunya tanda.
        pongTimer ??= setTimeout(() => lost(socket, CloseCode.ABNORMAL), HEARTBEAT.timeoutMs);
      }, HEARTBEAT.intervalMs);
    });

    socket.addEventListener("message", (event) => {
      if (ws !== socket) return;
      if (event.data === HEARTBEAT.response) {
        clearTimeout(pongTimer);
        pongTimer = undefined;
        return;
      }
      const decoded = options.decode(event.data);
      // Jenis pesan yang belum dikenal versi web ini diabaikan, supaya server bisa menambah pesan baru.
      if (decoded.ok) options.onMessage(decoded.data);
    });

    socket.addEventListener("close", (event) => lost(socket, event.code));
  }

  function lost(socket: WebSocket, code: number): void {
    // Close dari socket lama (sudah diganti, atau kita sendiri yang menutupnya) tidak mengubah apa pun.
    if (ws !== socket || stopped) return;
    ws = null;
    stopHeartbeat();
    socket.close();
    if (!shouldReconnect(code)) {
      stop();
      options.onEnd(code);
      return;
    }
    const delayMs = reconnectDelay(attempt, Math.random());
    attempt += 1;
    options.onStatus({ kind: "waiting", attempt, since: performance.now(), delayMs });
    retryTimer = setTimeout(open, delayMs);
  }

  function retryNow(): void {
    if (stopped || ws) return;
    open();
  }

  const onOnline = () => retryNow();
  const onVisible = () => {
    if (document.visibilityState === "visible") retryNow();
  };

  function stop(): void {
    stopped = true;
    clearTimeout(retryTimer);
    stopHeartbeat();
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  }

  // Sinyal kembali atau tab dibuka lagi: tidak perlu menunggu sisa jeda.
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  open();

  return {
    send(message) {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(encodeClientMessage(message));
      return true;
    },
    retryNow,
    markHealthy() {
      attempt = 0;
    },
    close() {
      stop();
      const socket = ws;
      ws = null;
      socket?.close(CloseCode.NORMAL);
    },
  };
}

const CLOSE_MESSAGES: Partial<Record<number, string>> = {
  [CloseCode.ROOM_NOT_FOUND]: "Room tidak ditemukan. Periksa lagi PIN-nya.",
  [CloseCode.UNSUPPORTED_VERSION]: "Sorak baru saja diperbarui. Muat ulang halaman.",
  [CloseCode.TOO_MANY_INVALID]: "Koneksi ditutup karena terjadi kesalahan. Muat ulang halaman.",
  [CloseCode.ROOM_FULL]: "Room sudah penuh.",
  [CloseCode.GAME_ALREADY_STARTED]: "Permainan sudah dimulai.",
};

/** Teks untuk penutupan yang tidak di-reconnect dan tidak punya layar khusus di reducer. */
export function closeMessage(code: number): string {
  return CLOSE_MESSAGES[code] ?? "Koneksi ditutup.";
}
