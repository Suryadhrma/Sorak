/**
 * Kode penutupan WebSocket.
 * 1000–1015 adalah kode standar; 4000–4999 bebas dipakai aplikasi.
 * Klien memutuskan reconnect atau tidak berdasarkan kode ini.
 */
export const CloseCode = {
  /** Ditutup normal. */
  NORMAL: 1000,
  /** Server pergi, misalnya karena deploy kode baru. Klien sebaiknya reconnect. */
  GOING_AWAY: 1001,
  /** Putus tanpa pesan penutup (sinyal hilang). Diberikan browser, bukan dikirim server. */
  ABNORMAL: 1006,
  /** Error internal server. Klien sebaiknya reconnect. */
  INTERNAL_ERROR: 1011,

  /** Game sudah selesai dan room dibersihkan. */
  ROOM_CLOSED: 4000,
  /** Dikeluarkan oleh host. */
  KICKED: 4001,
  /** Sesi yang sama tersambung dari tab/perangkat lain; koneksi lama ditutup. */
  REPLACED: 4002,
  /** Session token tidak dikenal. Klien harus join ulang dengan nickname. */
  SESSION_INVALID: 4003,
  /** PIN tidak ada atau room belum dibuka. */
  ROOM_NOT_FOUND: 4004,
  /** Versi protokol klien tidak didukung. Klien perlu memuat ulang halaman. */
  UNSUPPORTED_VERSION: 4005,
  /** Kirim pesan terlalu cepat (melewati rate limit). */
  RATE_LIMITED: 4008,
  /** Terlalu banyak pesan tidak valid beruntun. */
  TOO_MANY_INVALID: 4009,
  /** Room sudah penuh. */
  ROOM_FULL: 4010,
  /** Game sudah dimulai; pemain baru tidak bisa join. */
  GAME_ALREADY_STARTED: 4011,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

/**
 * Apakah klien boleh mencoba tersambung lagi setelah socket ditutup dengan kode ini?
 * Kode aplikasi (4000–4999) adalah keputusan sengaja dari server kecuali
 * RATE_LIMITED, yang boleh dicoba lagi setelah jeda backoff.
 */
export function shouldReconnect(code: number): boolean {
  if (code === CloseCode.NORMAL) return false;
  if (code === CloseCode.RATE_LIMITED) return true;
  if (code >= 4000 && code <= 4999) return false;
  return true;
}
