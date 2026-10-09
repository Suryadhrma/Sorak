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

/** Poin jawaban benar tercepat di mode Klasik. */
export const CLASSIC_MAX_POINTS = 1000;
/** Jawaban benar tepat di batas waktu mendapat setengah poin Klasik. */
export const CLASSIC_MIN_FACTOR = 0.5;
/** Poin setiap jawaban benar di mode Akurat, berapa pun kecepatannya. */
export const ACCURATE_POINTS = 1000;
/** Bonus per jawaban benar beruntun (benar kedua +50, ketiga +100, ...), dibatasi COMBO_MAX_POINTS. */
export const COMBO_STEP_POINTS = 50;
export const COMBO_MAX_POINTS = 250;

/** Room di tahap reveal yang ditinggal host (tidak menekan Lanjut) diakhiri. */
export const REVEAL_IDLE_TIMEOUT_MS = 1_800_000;
/** Room yang sudah selesai bertahan sebentar supaya layar akhir masih bisa dibuka ulang, lalu dibersihkan. */
export const ENDED_RETENTION_MS = 600_000;

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

/**
 * Socket pemain tanpa pong selama ini dianggap mati (HP hilang sinyal tanpa sempat menutup koneksi).
 * Dua interval ping + timeout: socket sehat pun bisa punya pong berumur hampir satu interval,
 * dan sinyal jelek bisa menelatkan satu ping.
 */
export const STALE_SOCKET_MS = HEARTBEAT.intervalMs * 2 + HEARTBEAT.timeoutMs;

/** Jeda reconnect bertahap (exponential backoff); jitter ditambahkan oleh klien. */
export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 5000] as const;

/**
 * Jeda reconnect = jeda dasar + acak antara 0 dan (rasio x jeda dasar). Tanpa jitter, ratusan HP yang WiFi-nya
 * pulih bersamaan mencoba tersambung di milidetik yang sama (thundering herd).
 */
export const RECONNECT_JITTER_RATIO = 0.5;

/** Batas pesan per detik per socket (token bucket). */
export const RATE_LIMIT = {
  capacity: 10,
  refillPerSecond: 10,
} as const;

/** Pesan tidak valid beruntun sebelum socket ditutup. */
export const MAX_CONSECUTIVE_INVALID_MESSAGES = 3;

export const REACTIONS = ["clap", "fire", "laugh", "wow", "heart"] as const;

/* Batas REST kuis dan akun host; harus sama dengan CHECK di apps/api/migrations/0001_init.sql. */
export const QUIZ_TITLE_MAX_LENGTH = 120;
export const QUIZ_DESCRIPTION_MAX_LENGTH = 500;
export const EXPLANATION_MAX_LENGTH = 500;
export const DISPLAY_NAME_MAX_LENGTH = 60;
export const DEFAULT_TIME_LIMIT_SEC = 20;

/** Batas baris halaman "Kuis saya". */
export const QUIZ_LIST_LIMIT = 100;

/** Batas body POST/PUT kuis. 50 soal penuh berhuruf Arab (2 byte per karakter di UTF-8) sekitar 130 KB. */
export const QUIZ_BODY_MAX_BYTES = 262_144;

/** Umur cookie sesi host: 7 hari. */
export const SESSION_TTL_SEC = 604_800;

/** Umur cookie state OAuth: cukup untuk memilih akun di halaman Google. */
export const OAUTH_STATE_TTL_SEC = 600;

/** Percobaan membuat PIN yang belum dipakai room lain sebelum menyerah. */
export const PIN_CREATE_ATTEMPTS = 5;

/** Lobby tanpa satu pun layar host tersambung selama ini ditutup, supaya PIN bebas lagi. */
export const LOBBY_IDLE_TIMEOUT_MS = 1_800_000;

/**
 * Batas cek PIN (GET /api/rooms/:pin) per IP (ADR 0005). Satu WiFi sekolah = satu IP (NAT),
 * jadi cukup untuk satu kelas masuk dalam semenit. Nilai yang berlaku ditulis di binding
 * `ratelimits` apps/api/wrangler.jsonc; test api memastikan keduanya sama.
 */
export const PIN_LOOKUP_LIMIT = { limit: 120, periodSec: 60 } as const;

/**
 * Batas upgrade WebSocket pemain (GET /ws/play/:pin) per IP (ADR 0005, lanjutan). Lebih longgar dari
 * cek PIN karena HP tersambung ulang sendiri: WiFi aula yang pulih membuat ratusan HP dari satu IP
 * menyambung hampir bersamaan. Nilai yang berlaku ditulis di wrangler.jsonc; test api memastikan sama.
 */
export const WS_CONNECT_LIMIT = { limit: 600, periodSec: 60 } as const;
