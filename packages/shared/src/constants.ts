/**
 * Angka-angka yang harus disepakati web, Worker, dan GameRoom.
 * Satu sumber kebenaran: ubah di sini, semua bagian ikut berubah.
 */

/** Naikkan kalau bentuk pesan berubah dengan cara yang tidak kompatibel. */
export const PROTOCOL_VERSION = 1;

/** Ukuran maksimal satu pesan WebSocket dari klien (byte, UTF-8). */
export const MAX_CLIENT_MESSAGE_BYTES = 4096;

export const MAX_PLAYERS_PER_ROOM = 200;
export const MAX_QUESTIONS_PER_QUIZ = 50;

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const PROMPT_MAX_LENGTH = 300;
export const OPTION_MAX_LENGTH = 100;

export const NICKNAME_MAX_LENGTH = 20;
export const TEAM_SIZE_MAX = 10;

export const TIME_LIMIT_MIN_SEC = 5;
export const TIME_LIMIT_MAX_SEC = 120;

/** Jendela toleransi setelah waktu habis, untuk jawaban yang tertahan sinyal. */
export const GRACE_MS = 2000;

/** Batas atas estimasi jeda satu arah; membatasi keuntungan dari menunda ack. */
export const MAX_ONE_WAY_LATENCY_MS = 1500;

/** Margin tambahan pada batas bawah waktu jawab (jitter jaringan dan proses). */
export const LATENCY_EPSILON_MS = 150;

/** Bobot sampel baru pada EWMA latency: d = (1 - a) * d_lama + a * sampel. */
export const LATENCY_EWMA_ALPHA = 0.3;

export const LEADERBOARD_SIZE = 10;
export const PODIUM_SIZE = 3;

/** Batas ukuran attachment WebSocket di Durable Object. */
export const ATTACHMENT_MAX_BYTES = 2048;

/** Batas ukuran satu pesan Cloudflare Queues. */
export const QUEUE_MESSAGE_MAX_BYTES = 128 * 1024;

/** Heartbeat berupa teks biasa supaya bisa dijawab auto-response tanpa membangunkan GameRoom. */
export const HEARTBEAT = {
  request: "ping",
  response: "pong",
  intervalMs: 15_000,
  timeoutMs: 5_000,
} as const;

/** Jeda reconnect bertahap (exponential backoff); jitter ditambahkan oleh klien. */
export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 5000] as const;

/** Batas pesan per detik per socket (token bucket). */
export const RATE_LIMIT = {
  capacity: 10,
  refillPerSecond: 10,
} as const;

/** Pesan tidak valid beruntun sebelum socket ditutup. */
export const MAX_CONSECUTIVE_INVALID_MESSAGES = 3;

export const REACTIONS = ["clap", "fire", "laugh", "wow", "heart"] as const;
