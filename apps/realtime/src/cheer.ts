import { CHEER_HOST_THROTTLE_MS, CHEER_PLAYER_THROTTLE_MS, CHEER_RECENT_MAX } from "@sorak/shared";

/**
 * Sorak di lobby, hanya di memori GameRoom: kalau objek hibernasi, total kembali 0. Dekorasi tidak layak memakan
 * kuota tulis storage. `recent` = penyorak sejak cheer terakhir dikirim ke host.
 */
export type CheerState = {
  total: number;
  recent: string[];
  hostSentAt: number | null;
  playersSentAt: number | null;
};

export const emptyCheer: CheerState = { total: 0, recent: [], hostSentAt: null, playersSentAt: null };

export type CheerOutcome = {
  state: CheerState;
  /** Dikirim ke host sekarang, atau null kalau masih dalam jeda 300 ms. */
  toHost: { total: number; recent: string[] } | null;
  /** Dikirim ke semua pemain sekarang, atau null kalau masih dalam jeda 2 detik. */
  toPlayers: { total: number } | null;
};

/**
 * Leading-edge throttle tanpa timer (GameRoom tidak boleh memakai setTimeout): sorak pertama langsung dikirim,
 * sorak di sela jeda ikut terhitung dan terbawa di kiriman berikutnya. Akibatnya sorak terakhir dalam satu
 * rentetan bisa tertahan sampai ada sorak lagi; untuk dekorasi itu bisa diterima.
 */
export function addCheer(state: CheerState, nickname: string, now: number): CheerOutcome {
  const total = state.total + 1;
  const recent = [...state.recent, nickname].slice(-CHEER_RECENT_MAX);
  const hostDue = state.hostSentAt === null || now - state.hostSentAt >= CHEER_HOST_THROTTLE_MS;
  const playersDue = state.playersSentAt === null || now - state.playersSentAt >= CHEER_PLAYER_THROTTLE_MS;
  return {
    state: {
      total,
      recent: hostDue ? [] : recent,
      hostSentAt: hostDue ? now : state.hostSentAt,
      playersSentAt: playersDue ? now : state.playersSentAt,
    },
    toHost: hostDue ? { total, recent } : null,
    toPlayers: playersDue ? { total } : null,
  };
}
