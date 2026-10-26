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

/** Hitung mundur berwarna waktu-kritis di detik-detik terakhir ini. */
export const COUNTDOWN_URGENT_SEC = 5;

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

/** Batas ukuran satu pesan Cloudflare Queues: 128 KB = 128.000 byte menurut dokumentasi (1 KB = 1000 byte). */
export const QUEUE_MESSAGE_MAX_BYTES = 128_000;
/** Batas event game_ended (JSON UTF-8): 100 byte disisakan untuk metadata pesan Queue. */
export const GAME_EVENT_MAX_BYTES = QUEUE_MESSAGE_MAX_BYTES - 100;
/**
 * Panjang teks soal dan pilihan (huruf Unicode, termasuk "…") kalau event utuh lewat GAME_EVENT_MAX_BYTES.
 * Dipilih supaya kasus terburuk (200 pemain, 50 soal, semua teks 3 byte per huruf) sekitar 111,6 KB:
 * sisa ruang di atas 10%.
 */
export const GAME_EVENT_TRUNCATED_PROMPT_LENGTH = 120;
export const GAME_EVENT_TRUNCATED_OPTION_LENGTH = 30;

/** Jeda GameRoom mencoba ulang kirim event kalau Queue gagal; setelah elemen terakhir, jeda tetap di situ. */
export const GAME_EVENT_RETRY_MS = [30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000] as const;
/** GameRoom berhenti mencoba kirim event setelah selama ini sejak game selesai, lalu mencatat event hilang. */
export const GAME_EVENT_GIVE_UP_MS = 86_400_000;

/** Batas D1 di plan Free (dokumentasi D1 limits): query per pemanggilan Worker dan parameter per query. */
export const D1_MAX_QUERIES_PER_INVOCATION = 50;
export const D1_MAX_BOUND_PARAMETERS = 100;

/** Jeda dasar consumer mencoba ulang simpan event (detik), digandakan per percobaan; sama dengan retry_delay di apps/api/wrangler.jsonc. */
export const GAME_EVENT_CONSUMER_RETRY_DELAY_SEC = 60;

/** Umur maksimal hasil game di D1; yang lebih tua dihapus cron. */
export const GAME_RESULT_RETENTION_DAYS = 30;
/** Cron retensi: game yang dihapus per putaran, dan batas putaran per pemanggilan (di bawah batas query D1). */
export const RETENTION_DELETE_BATCH = 25;
export const RETENTION_MAX_ROUNDS = 40;
/** Jumlah game per halaman riwayat. */
export const GAMES_PAGE_SIZE = 20;

/** Laporan guru: pengecoh terpopuler ditampilkan kalau dipilih minimal porsi ini dari yang menjawab. */
export const DISTRACTOR_MIN_SHARE = 0.2;
/** Soal dengan persen benar di bawah angka ini ditandai "Perlu dibahas ulang". */
export const REVIEW_BELOW_PERCENT = 50;
/** Laporan dibuka dari podium: 404 dalam jendela ini berarti consumer Queue belum selesai menyimpan. */
export const REPORT_SAVING_WINDOW_MS = 60_000;
export const REPORT_RETRY_ATTEMPTS = 3;
export const REPORT_RETRY_DELAY_MS = 2000;

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

export const REACTIONS = ["clap", "fire", "laugh", "wow", "heart", "sorak"] as const;

/*
 * Tombol Sorak di lobby (B5). Sorak hanya dekorasi, jadi tidak pernah menutup socket dan tidak ditulis ke storage.
 * Ember kedua per socket, khusus sorak: penuh 5, terisi 2 per detik; kelebihannya dibuang diam-diam.
 */
export const CHEER_LIMIT = {
  capacity: 5,
  refillPerSecond: 2,
} as const;
/** Leading-edge throttle tanpa timer: cheer ke host paling cepat tiap 300 ms, cheer_total ke pemain tiap 2 detik. */
export const CHEER_HOST_THROTTLE_MS = 300;
export const CHEER_PLAYER_THROTTLE_MS = 2_000;
/** Nama penyorak terakhir yang dikirim ke proyektor. */
export const CHEER_RECENT_MAX = 5;
/** HP: "tenaga sorak" 5 garis turus; satu tekan memakai satu garis, terisi lagi satu setiap 0,6 detik. */
export const CHEER_ENERGY_MAX = 5;
export const CHEER_ENERGY_REFILL_MS = 600;
export const CHEER_VIBRATE_MS = 15;
/** Proyektor: label nama penyorak yang tampil bersamaan; yang lebih dibuang. */
export const CHEER_FLOATS_MAX = 6;

/* Batas REST kuis dan akun host; harus sama dengan CHECK di apps/api/migrations/0001_init.sql. */
export const QUIZ_TITLE_MAX_LENGTH = 120;
export const QUIZ_DESCRIPTION_MAX_LENGTH = 500;
export const EXPLANATION_MAX_LENGTH = 500;
export const DISPLAY_NAME_MAX_LENGTH = 60;
export const DEFAULT_TIME_LIMIT_SEC = 20;

/*
 * Draf soal AI dari teks materi (Hari 6, F-10). Batas Groq Free per organisasi: 30 request/menit, 1.000/hari,
 * 8.000 token/menit (satu generate sekitar 4.000-5.000 token). Kuota per guru dihitung dari tabel ai_generations.
 */
export const AI_DAILY_LIMIT_PER_HOST = 20;
export const AI_SOURCE_MIN_CHARS = 200;
export const AI_SOURCE_MAX_CHARS = 8_000;
export const AI_QUESTION_COUNTS = [5, 10] as const;
/** Draf AI selalu 4 pilihan (editor manual tetap boleh 2-4). */
export const AI_OPTION_COUNT = 4;
export const AI_EXPLANATION_MAX_CHARS = 300;
/** Kutipan bukti dari materi; bukti yang lebih panjang dipotong saat divalidasi. */
export const AI_EVIDENCE_MAX_CHARS = 200;
/** Kutipan sependek ini hampir pasti ada di materi mana pun, jadi tidak dianggap bukti. */
export const AI_GROUNDING_MIN_CHARS = 20;
export const AI_REQUEST_TIMEOUT_MS = 25_000;
/** Naikkan setiap kali prompt berubah, lalu jalankan ulang evaluasi (tools/ai-eval). */
export const AI_PROMPT_VERSION = "gen-text-v1";

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
