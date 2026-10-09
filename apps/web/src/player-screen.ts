import { CloseCode, type Phase, type PlayerServerMessage, type PublicQuestion } from "@sorak/shared";
import { closeMessage } from "./socket.ts";

/**
 * Layar siswa sebagai fungsi murni: (layar sekarang, kejadian) -> layar berikutnya.
 * Waktu (`at`) diberikan dari luar, jadi urutan pesan sungguhan bisa diuji tanpa browser.
 * Status koneksi (tersambung, menunggu reconnect) tidak ada di sini: soal tetap tampil saat sinyal putus.
 */

type ResultMessage = Extract<PlayerServerMessage, { t: "result" }>;
type FinalMessage = Extract<PlayerServerMessage, { t: "final" }>;

export type Me = { playerId: string; nickname: string };

export type PlayerView =
  | { kind: "nickname"; error: string | null; busy: boolean }
  | { kind: "connecting" }
  /** Tersambung lagi saat reveal/ended: menunggu result/final yang dikirim ulang server. */
  | { kind: "syncing"; me: Me }
  | { kind: "lobby"; me: Me; playerCount: number }
  /**
   * startedAt = performance.now() saat soal (atau snapshot) diterima, durationMs = sisa waktu saat itu.
   * choice terisi begitu tombol ditekan; confirmed setelah answer_received atau snapshot answered.
   */
  | {
      kind: "question";
      me: Me;
      question: PublicQuestion;
      startedAt: number;
      durationMs: number;
      choice: number | null;
      confirmed: boolean;
    }
  | { kind: "grace"; me: Me; answered: boolean }
  | { kind: "result"; me: Me; result: ResultMessage }
  | { kind: "final"; me: Me; final: FinalMessage }
  /** takeOver: tombol "Pakai di sini" (Sorak dibuka di tab atau HP lain). */
  | { kind: "ended"; message: string; takeOver: boolean };

/** lastPhase: tahap terakhir yang diketahui HP, untuk memilih teks saat koneksi ditutup server. */
export type PlayerScreen = { view: PlayerView; lastPhase: Phase | null };

export type PlayerEvent =
  | { type: "server"; message: PlayerServerMessage; at: number }
  | { type: "answer_sent"; choice: number }
  /** Ditutup server dengan kode yang tidak di-reconnect. */
  | { type: "ended"; code: number };

export const initialPlayerScreen: PlayerScreen = { view: { kind: "connecting" }, lastPhase: null };

const NICKNAME_ERRORS = {
  NICKNAME_TAKEN: "Nickname sudah dipakai pemain lain. Coba nama lain.",
  NICKNAME_INVALID: "Nickname hanya boleh huruf, angka, spasi, titik, _ dan -.",
  NICKNAME_REJECTED: "Nama ini tidak bisa dipakai. Coba nama lain.",
} as const;

export function playerScreen(screen: PlayerScreen, event: PlayerEvent): PlayerScreen {
  if (event.type === "ended") return { ...screen, view: endedView(screen, event.code) };
  if (event.type === "answer_sent") {
    const { view } = screen;
    if (view.kind !== "question" || view.choice !== null || view.confirmed) return screen;
    return { ...screen, view: { ...view, choice: event.choice } };
  }
  return onMessage(screen, event.message, event.at);
}

function onMessage(screen: PlayerScreen, message: PlayerServerMessage, at: number): PlayerScreen {
  const { view } = screen;
  const me = meOf(view);
  switch (message.t) {
    case "welcome":
      return fromWelcome(message, at);
    case "lobby":
      return view.kind === "lobby" ? { view: { ...view, playerCount: message.playerCount }, lastPhase: "lobby" } : screen;
    case "question": {
      if (!me) return screen;
      const { t: _type, ...question } = message;
      return {
        view: { kind: "question", me, question, startedAt: at, durationMs: question.durationMs, choice: null, confirmed: false },
        lastPhase: "question",
      };
    }
    case "answer_received":
      // Tersambung lagi saat grace lalu jawaban antrean dikirim ulang: konfirmasinya datang di layar grace.
      if (view.kind === "grace") return { ...screen, view: { ...view, answered: true } };
      if (view.kind !== "question" || view.question.q !== message.q) return screen;
      return { ...screen, view: { ...view, confirmed: true } };
    case "grace":
      if (!me) return screen;
      return { view: { kind: "grace", me, answered: view.kind === "question" && (view.choice !== null || view.confirmed) }, lastPhase: "grace" };
    case "result":
      return me ? { view: { kind: "result", me, result: message }, lastPhase: "reveal" } : screen;
    case "final":
      return me ? { view: { kind: "final", me, final: message }, lastPhase: "ended" } : screen;
    case "error":
      // Error nickname tidak memutus koneksi; error lain selalu diikuti close, dan teksnya dari close code.
      if (message.code === "NICKNAME_TAKEN" || message.code === "NICKNAME_INVALID" || message.code === "NICKNAME_REJECTED") {
        return { ...screen, view: { kind: "nickname", error: NICKNAME_ERRORS[message.code], busy: false } };
      }
      return screen;
    default:
      return screen;
  }
}

/** Snapshot di welcome (join atau tersambung lagi) langsung membawa HP ke layar tahap saat ini. */
function fromWelcome(message: Extract<PlayerServerMessage, { t: "welcome" }>, at: number): PlayerScreen {
  const me: Me = { playerId: message.playerId, nickname: message.nickname };
  const { snapshot } = message;
  const lastPhase = snapshot.phase;
  switch (snapshot.phase) {
    case "lobby":
      return { view: { kind: "lobby", me, playerCount: snapshot.playerCount }, lastPhase };
    case "question":
      if (!snapshot.question) return { view: { kind: "syncing", me }, lastPhase };
      return {
        view: {
          kind: "question",
          me,
          question: snapshot.question,
          startedAt: at,
          // Hitung mundur dilanjutkan dari sisa waktu server, bukan diulang dari awal.
          durationMs: snapshot.remainingMs ?? snapshot.question.durationMs,
          choice: null,
          confirmed: snapshot.answered,
        },
        lastPhase,
      };
    case "grace":
      return { view: { kind: "grace", me, answered: snapshot.answered }, lastPhase };
    case "reveal":
    case "ended":
      // Server langsung mengirim ulang result atau final setelah welcome.
      return { view: { kind: "syncing", me }, lastPhase };
  }
}

function endedView(screen: PlayerScreen, code: number): PlayerView {
  const { view, lastPhase } = screen;
  // Room dibersihkan beberapa menit setelah podium; skor akhir tetap di layar.
  if (view.kind === "final") return view;
  const inLobby = lastPhase === null || lastPhase === "lobby";
  switch (code) {
    case CloseCode.ROOM_CLOSED:
      // Kode yang sama dipakai untuk dua kejadian: room dibatalkan di lobby, atau game sudah selesai dibersihkan.
      return { kind: "ended", message: inLobby ? "Room ditutup oleh guru." : "Game sudah selesai.", takeOver: false };
    case CloseCode.KICKED:
      return { kind: "ended", message: "Kamu dikeluarkan dari ruang ini oleh guru.", takeOver: false };
    case CloseCode.REPLACED:
      return { kind: "ended", message: "Sorak sedang dibuka di tab atau HP lain.", takeOver: true };
    case CloseCode.SESSION_INVALID:
      if (inLobby) return { kind: "nickname", error: null, busy: false };
      return { kind: "ended", message: "Sesi tidak dikenali. Game sudah berjalan, jadi kamu belum bisa masuk lagi.", takeOver: false };
    default:
      return { kind: "ended", message: closeMessage(code), takeOver: false };
  }
}

function meOf(view: PlayerView): Me | null {
  switch (view.kind) {
    case "syncing":
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
