import { CloseCode, type HostServerMessage, type PublicQuestion, type RoomInfo, type RosterEntry } from "@sorak/shared";
import { closeMessage } from "./socket.ts";

/**
 * Layar proyektor sebagai fungsi murni: (tampilan sekarang, kejadian) -> tampilan berikutnya.
 * Waktu (`at`) diberikan dari luar, jadi urutan pesan sungguhan bisa diuji tanpa browser.
 */

type HostWelcomeMessage = Extract<HostServerMessage, { t: "host_welcome" }>;
type RevealMessage = Extract<HostServerMessage, { t: "reveal" }>;
type PodiumMessage = Extract<HostServerMessage, { t: "podium" }>;

/** Bagian yang ada di semua tahap: info room, daftar pemain, dan pesan dari server (misalnya "Belum ada pemain"). */
export type HostBase = { room: RoomInfo; players: RosterEntry[]; notice: string | null };

export type HostView =
  | { kind: "connecting" }
  /** Setelah refresh di reveal/ended: menunggu pesan reveal/podium yang dikirim ulang server. */
  | { kind: "syncing"; base: HostBase; question: PublicQuestion | null }
  | { kind: "lobby"; base: HostBase }
  | { kind: "question"; base: HostBase; question: PublicQuestion; startedAt: number; durationMs: number; answered: number; total: number }
  | { kind: "grace"; base: HostBase; question: PublicQuestion; answered: number; total: number }
  | { kind: "reveal"; base: HostBase; question: PublicQuestion | null; reveal: RevealMessage }
  | { kind: "ended"; base: HostBase; podium: PodiumMessage }
  | { kind: "closed"; message: string; canRetry: boolean };

export type HostEvent = { type: "server"; message: HostServerMessage; at: number } | { type: "closed"; code: number };

export function applyRosterMessage(players: RosterEntry[], message: HostServerMessage): RosterEntry[] {
  switch (message.t) {
    case "player_joined":
      // Pemain yang sama bisa muncul lagi (misalnya setelah resume); jangan sampai namanya ganda.
      return [...players.filter((player) => player.playerId !== message.player.playerId), message.player];
    case "player_left":
      // Selama game pemain yang putus tetap peserta, hanya tidak tersambung. Di lobby ia dibuang (lihat hostScreen).
      return players.map((player) => (player.playerId === message.playerId ? { ...player, connected: false } : player));
    default:
      return players;
  }
}

export function hostScreen(view: HostView, event: HostEvent): HostView {
  if (event.type === "closed") return closedView(view, event.code);

  const { message, at } = event;
  if (message.t === "host_welcome") return fromWelcome(message, at);
  const base = baseOf(view);
  if (!base) return view;
  const next: HostBase = { ...base, players: applyRosterMessage(base.players, message) };

  switch (message.t) {
    case "player_joined":
      return withBase(view, next);
    case "player_left": {
      const players = view.kind === "lobby" ? next.players.filter((player) => player.playerId !== message.playerId) : next.players;
      return withBase(view, { ...next, players });
    }
    case "question": {
      const { t: _type, ...question } = message;
      return {
        kind: "question",
        base: { ...next, notice: null },
        question,
        startedAt: at,
        durationMs: question.durationMs,
        answered: 0,
        total: next.players.length,
      };
    }
    case "answer_count":
      if (view.kind !== "question" && view.kind !== "grace") return view;
      return { ...view, answered: message.answered, total: message.total };
    case "grace":
      if (view.kind !== "question") return view;
      return { kind: "grace", base: next, question: view.question, answered: view.answered, total: view.total };
    case "reveal":
      return { kind: "reveal", base: { ...next, notice: null }, question: questionOf(view), reveal: message };
    case "podium":
      return { kind: "ended", base: { ...next, notice: null }, podium: message };
    case "error":
      return withBase(view, { ...next, notice: message.message });
    default:
      return view;
  }
}

function fromWelcome(message: HostWelcomeMessage, at: number): HostView {
  const base: HostBase = { room: message.room, players: message.players, notice: null };
  const total = message.players.length;
  switch (message.phase) {
    case "lobby":
      return { kind: "lobby", base };
    case "question":
      if (!message.question) return { kind: "syncing", base, question: null };
      return {
        kind: "question",
        base,
        question: message.question,
        startedAt: at,
        // Setelah refresh, hitung mundur memakai sisa waktu dari server, bukan durasi penuh.
        durationMs: message.remainingMs ?? message.question.durationMs,
        answered: message.answered,
        total,
      };
    case "grace":
      if (!message.question) return { kind: "syncing", base, question: null };
      return { kind: "grace", base, question: message.question, answered: message.answered, total };
    case "reveal":
    case "ended":
      return { kind: "syncing", base, question: message.question };
  }
}

function closedView(view: HostView, code: number): HostView {
  // Room dibersihkan beberapa menit setelah podium; podium tetap di layar.
  if (view.kind === "ended" && code === CloseCode.ROOM_CLOSED) return view;
  if (code === CloseCode.ROOM_NOT_FOUND) {
    return { kind: "closed", message: "Room tidak ditemukan, atau bukan milik akun ini.", canRetry: false };
  }
  if (code === CloseCode.ROOM_CLOSED) return { kind: "closed", message: "Room sudah ditutup.", canRetry: false };
  return { kind: "closed", ...closeMessage(code) };
}

function baseOf(view: HostView): HostBase | null {
  return view.kind === "connecting" || view.kind === "closed" ? null : view.base;
}

function withBase(view: HostView, base: HostBase): HostView {
  return view.kind === "connecting" || view.kind === "closed" ? view : { ...view, base };
}

function questionOf(view: HostView): PublicQuestion | null {
  switch (view.kind) {
    case "question":
    case "grace":
    case "syncing":
    case "reveal":
      return view.question;
    default:
      return null;
  }
}
