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

/** Poin total, peringkat, dan kombo terakhir yang diketahui HP (dari welcome atau result). */
export type Standing = { score: number; rank: number | null; streak: number };

export type PlayerView =
  | { kind: "nickname"; error: string | null; busy: boolean }
  | { kind: "connecting" }
  /** Tersambung lagi saat reveal/ended: menunggu result/final yang dikirim ulang server. */
  | { kind: "syncing"; me: Me }
  /** cheerTotal: "Kelas sudah bersorak N kali" (cheer_total); 0 sampai kiriman pertama datang. */
  | { kind: "lobby"; me: Me; playerCount: number; cheerTotal: number }
  /**
   * startedAt = performance.now() saat soal (atau snapshot) diterima, durationMs = sisa waktu saat itu.
   * choice terisi begitu tombol ditekan; confirmed setelah answer_received atau snapshot answered.
   * elapsedMs: lama berpikir saat tombol ditekan ("Kamu menjawab di detik ke-…"); null kalau belum menekan di HP ini.
   */
  | {
      kind: "question";
      me: Me;
      question: PublicQuestion;
      startedAt: number;
      durationMs: number;
      choice: number | null;
      confirmed: boolean;
      elapsedMs: number | null;
    }
  | { kind: "grace"; me: Me; answered: boolean }
  /**
   * previous: keadaan sebelum soal ini (untuk "Naik X tingkat" dan "Kombo terputus").
   * question dan choice: soal dan pilihan pemain untuk soal ini, kalau HP masih ingat (null setelah resume di reveal).
   */
  | { kind: "result"; me: Me; result: ResultMessage; previous: Standing; question: PublicQuestion | null; choice: number | null }
  | { kind: "final"; me: Me; final: FinalMessage }
  /** takeOver: tombol "Pakai di sini" (Sorak dibuka di tab atau HP lain). */
  | { kind: "ended"; message: string; takeOver: boolean };

/**
 * lastPhase: tahap terakhir yang diketahui HP, untuk memilih teks saat koneksi ditutup server.
 * quizTitle: dari welcome; null kalau GameRoom versi lama tidak mengirimnya.
 * lastQuestion dan lastChoice: soal terakhir yang tampil dan pilihan pemain, untuk layar hasil.
 */
export type PlayerScreen = {
  view: PlayerView;
  lastPhase: Phase | null;
  quizTitle: string | null;
  standing: Standing;
  lastQuestion: PublicQuestion | null;
  lastChoice: number | null;
};

export type PlayerEvent =
  | { type: "server"; message: PlayerServerMessage; at: number }
  | { type: "answer_sent"; choice: number; elapsedMs: number }
  /** Ditutup server dengan kode yang tidak di-reconnect. */
  | { type: "ended"; code: number };

export const initialPlayerScreen: PlayerScreen = {
  view: { kind: "connecting" },
  lastPhase: null,
  quizTitle: null,
  standing: { score: 0, rank: null, streak: 0 },
  lastQuestion: null,
  lastChoice: null,
};

const NICKNAME_ERRORS = {
  NICKNAME_TAKEN: "Nickname sudah dipakai pemain lain. Coba nama lain.",
  NICKNAME_INVALID: "Nickname hanya boleh huruf, angka, spasi, titik, _ dan -.",
  NICKNAME_REJECTED: "Nama ini tidak bisa dipakai. Coba nama lain.",
} as const;

/** Naik berapa tingkat dibanding peringkat sebelumnya; null kalau tidak naik (atau belum ada peringkat lama). */
export function rankClimb(previous: number | null, current: number): number | null {
  if (previous === null || current >= previous) return null;
  return previous - current;
}

export function playerScreen(screen: PlayerScreen, event: PlayerEvent): PlayerScreen {
  if (event.type === "ended") return { ...screen, view: endedView(screen, event.code) };
  if (event.type === "answer_sent") {
    const { view } = screen;
    if (view.kind !== "question" || view.choice !== null || view.confirmed) return screen;
    return { ...screen, view: { ...view, choice: event.choice, elapsedMs: event.elapsedMs }, lastChoice: event.choice };
  }
  return onMessage(screen, event.message, event.at);
}

function onMessage(screen: PlayerScreen, message: PlayerServerMessage, at: number): PlayerScreen {
  const { view } = screen;
  const me = meOf(view);
  switch (message.t) {
    case "welcome":
      return fromWelcome(screen, message, at);
    case "lobby":
      return view.kind === "lobby" ? { ...screen, view: { ...view, playerCount: message.playerCount }, lastPhase: "lobby" } : screen;
    case "cheer_total":
      return view.kind === "lobby" ? { ...screen, view: { ...view, cheerTotal: message.total } } : screen;
    case "question": {
      if (!me) return screen;
      const { t: _type, ...question } = message;
      return {
        ...screen,
        view: { kind: "question", me, question, startedAt: at, durationMs: question.durationMs, choice: null, confirmed: false, elapsedMs: null },
        lastPhase: "question",
        lastQuestion: question,
        lastChoice: null,
      };
    }
    case "answer_received":
      // Tersambung lagi saat grace lalu jawaban antrean dikirim ulang: konfirmasinya datang di layar grace.
      if (view.kind === "grace") return { ...screen, view: { ...view, answered: true } };
      if (view.kind !== "question" || view.question.q !== message.q) return screen;
      return { ...screen, view: { ...view, confirmed: true } };
    case "grace":
      if (!me) return screen;
      return {
        ...screen,
        view: { kind: "grace", me, answered: view.kind === "question" && (view.choice !== null || view.confirmed) },
        lastPhase: "grace",
      };
    case "result": {
      if (!me) return screen;
      const sameQuestion = screen.lastQuestion?.q === message.q;
      return {
        ...screen,
        view: {
          kind: "result",
          me,
          result: message,
          previous: screen.standing,
          question: sameQuestion ? screen.lastQuestion : null,
          choice: sameQuestion ? screen.lastChoice : null,
        },
        lastPhase: "reveal",
        standing: { score: message.score, rank: message.rank, streak: message.streak },
      };
    }
    case "final":
      return me
        ? { ...screen, view: { kind: "final", me, final: message }, lastPhase: "ended", standing: { ...screen.standing, score: message.score, rank: message.rank } }
        : screen;
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
function fromWelcome(screen: PlayerScreen, message: Extract<PlayerServerMessage, { t: "welcome" }>, at: number): PlayerScreen {
  const me: Me = { playerId: message.playerId, nickname: message.nickname };
  const { snapshot } = message;
  const base: PlayerScreen = {
    ...screen,
    lastPhase: snapshot.phase,
    quizTitle: message.room.quizTitle ?? null,
    standing: { score: snapshot.score, rank: snapshot.rank, streak: snapshot.streak },
  };
  switch (snapshot.phase) {
    case "lobby":
      return { ...base, view: { kind: "lobby", me, playerCount: snapshot.playerCount, cheerTotal: 0 } };
    case "question": {
      if (!snapshot.question) return { ...base, view: { kind: "syncing", me } };
      // Soal yang sama dengan sebelum putus: pilihan yang sudah ditekan di HP ini tetap diingat.
      const sameQuestion = screen.lastQuestion?.q === snapshot.question.q;
      return {
        ...base,
        view: {
          kind: "question",
          me,
          question: snapshot.question,
          startedAt: at,
          // Hitung mundur dilanjutkan dari sisa waktu server, bukan diulang dari awal.
          durationMs: snapshot.remainingMs ?? snapshot.question.durationMs,
          choice: null,
          confirmed: snapshot.answered,
          elapsedMs: null,
        },
        lastQuestion: snapshot.question,
        lastChoice: sameQuestion ? screen.lastChoice : null,
      };
    }
    case "grace":
      return { ...base, view: { kind: "grace", me, answered: snapshot.answered } };
    case "reveal":
    case "ended":
      // Server langsung mengirim ulang result atau final setelah welcome.
      return { ...base, view: { kind: "syncing", me } };
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
