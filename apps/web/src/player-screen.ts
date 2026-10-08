import type { PlayerServerMessage, PublicQuestion } from "@sorak/shared";
import { closeMessage } from "./socket.ts";

/**
 * Layar siswa sebagai fungsi murni: (tampilan sekarang, kejadian) -> tampilan berikutnya.
 * Waktu (`at`) diberikan dari luar, jadi urutan pesan sungguhan bisa diuji tanpa browser.
 */

type ResultMessage = Extract<PlayerServerMessage, { t: "result" }>;
type FinalMessage = Extract<PlayerServerMessage, { t: "final" }>;

export type Me = { playerId: string; nickname: string };

export type PlayerView =
  | { kind: "nickname"; error: string | null; busy: boolean }
  | { kind: "connecting" }
  | { kind: "lobby"; me: Me; playerCount: number }
  /** startedAt = performance.now() saat soal diterima; choice terisi begitu tombol ditekan, confirmed setelah answer_received. */
  | { kind: "question"; me: Me; question: PublicQuestion; startedAt: number; choice: number | null; confirmed: boolean }
  | { kind: "grace"; me: Me; answered: boolean }
  | { kind: "result"; me: Me; result: ResultMessage }
  | { kind: "final"; me: Me; final: FinalMessage }
  | { kind: "ended"; message: string; canRetry: boolean };

export type PlayerEvent =
  | { type: "server"; message: PlayerServerMessage; at: number }
  | { type: "answer_sent"; choice: number }
  | { type: "closed"; code: number };

const NICKNAME_ERRORS = {
  NICKNAME_TAKEN: "Nickname sudah dipakai pemain lain. Coba nama lain.",
  NICKNAME_INVALID: "Nickname hanya boleh huruf, angka, spasi, titik, _ dan -.",
} as const;

export function playerScreen(view: PlayerView, event: PlayerEvent): PlayerView {
  if (event.type === "closed") {
    // Room dibersihkan beberapa menit setelah podium; skor akhir tetap di layar.
    if (view.kind === "final") return view;
    return { kind: "ended", ...closeMessage(event.code) };
  }
  if (event.type === "answer_sent") {
    if (view.kind !== "question" || view.choice !== null) return view;
    return { ...view, choice: event.choice };
  }

  const { message, at } = event;
  const me = meOf(view);
  switch (message.t) {
    case "welcome":
      return { kind: "lobby", me: { playerId: message.playerId, nickname: message.nickname }, playerCount: message.snapshot.playerCount };
    case "lobby":
      return view.kind === "lobby" ? { ...view, playerCount: message.playerCount } : view;
    case "question": {
      if (!me) return view;
      const { t: _type, ...question } = message;
      return { kind: "question", me, question, startedAt: at, choice: null, confirmed: false };
    }
    case "answer_received":
      return view.kind === "question" && view.question.q === message.q ? { ...view, confirmed: true } : view;
    case "grace":
      if (!me) return view;
      return { kind: "grace", me, answered: view.kind === "question" && view.choice !== null };
    case "result":
      return me ? { kind: "result", me, result: message } : view;
    case "final":
      return me ? { kind: "final", me, final: message } : view;
    case "error":
      // Error nickname tidak memutus koneksi; error lain selalu diikuti close, dan teksnya dari close code.
      if (message.code === "NICKNAME_TAKEN" || message.code === "NICKNAME_INVALID") {
        return { kind: "nickname", error: NICKNAME_ERRORS[message.code], busy: false };
      }
      return view;
    default:
      return view;
  }
}

function meOf(view: PlayerView): Me | null {
  switch (view.kind) {
    case "lobby":
    case "question":
    case "grace":
    case "result":
    case "final":
      return view.me;
    default:
      return null;
  }
}
