import {
  GAME_EVENT_MAX_BYTES,
  GAME_EVENT_RETRY_MS,
  GAME_EVENT_TRUNCATED_OPTION_LENGTH,
  GAME_EVENT_TRUNCATED_PROMPT_LENGTH,
  type GameEndedEvent,
  type QuestionStats,
  type QuizSnapshot,
  type RoomState,
  type Roster,
  type Scoreboard,
} from "@sorak/shared";
import { emptyScore, rankPlayers } from "./reveal.ts";

/**
 * Event game_ended untuk Queue: disusun dari storage GameRoom, lalu dipastikan muat di batas ukuran pesan.
 * Fungsi murni; GameRoom yang memvalidasi, mengirim, dan mencatat log.
 */

export type GameEventInput = {
  /** Game yang sudah dimulai dan sudah selesai: kedua waktu pasti ada. */
  state: RoomState & { startedAt: number; endedAt: number };
  quiz: QuizSnapshot;
  roster: Roster;
  scoreboard: Scoreboard;
  qstats: readonly QuestionStats[];
};

export type FittedGameEvent =
  | { kind: "whole"; event: GameEndedEvent; bytes: number }
  | { kind: "truncated"; event: GameEndedEvent; bytes: number; originalBytes: number }
  | { kind: "too_large"; bytes: number; originalBytes: number };

export function buildGameEndedEvent(input: GameEventInput): GameEndedEvent {
  const { state, quiz, roster, scoreboard, qstats } = input;
  // Peringkat yang sama dengan reveal dan podium. Pemain yang sudah di-kick tidak ada di roster, jadi tidak ikut.
  const players = rankPlayers(roster, scoreboard).map((entry) => {
    const score = scoreboard[entry.playerId] ?? emptyScore();
    return {
      playerId: entry.playerId,
      nickname: entry.nickname,
      teamSize: entry.teamSize,
      finalScore: score.score,
      finalRank: entry.rank,
      correctCount: score.correct,
      answeredCount: score.answered,
      highlights: {
        bestStreak: score.bestStreak,
        confidentCorrect: score.confidentCorrect,
        biggestRankClimb: score.biggestRankClimb,
        fastestCorrectMs: score.fastestCorrectMs,
      },
    };
  });
  // Hanya soal yang sudah di-reveal: qstats terisi satu per reveal.
  const questions = qstats.map((stats, position) => {
    const question = quiz.questions[position];
    if (!question) throw new Error(`statistik soal ${position} tidak punya soal di kuis`);
    return {
      position,
      questionId: question.questionId,
      prompt: question.prompt,
      options: question.options,
      correctIndex: question.correctIndex,
      answerCounts: stats.answerCounts,
      answeredCount: stats.answered,
      correctCount: stats.correct,
      // Rata-rata waktu jawaban yang BENAR saja, bukan semua jawaban: "seberapa cepat yang paham menjawab".
      avgAnswerMs: stats.correct === 0 ? null : Math.round(stats.totalCorrectMs / stats.correct),
      confidentWrongCount: stats.confidentWrong,
    };
  });
  return {
    type: "game_ended",
    v: 1,
    gameId: state.gameId,
    hostId: state.hostId,
    quizId: quiz.quizId,
    quizTitle: quiz.title,
    pin: state.pin,
    scoringMode: state.scoringMode,
    teamMode: state.teamMode,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    players,
    questions,
  };
}

/**
 * Event utuh kalau muat di GAME_EVENT_MAX_BYTES. Kalau tidak, teks soal dan pilihan dipotong (teks di laporan
 * hanya pengingat; skor dan statistik tetap utuh). Kalau masih tidak muat, event tidak bisa dikirim sama sekali.
 */
export function fitGameEvent(event: GameEndedEvent): FittedGameEvent {
  const originalBytes = jsonBytes(event);
  if (originalBytes <= GAME_EVENT_MAX_BYTES) return { kind: "whole", event, bytes: originalBytes };

  const truncated: GameEndedEvent = {
    ...event,
    questions: event.questions.map((question) => ({
      ...question,
      prompt: truncateText(question.prompt, GAME_EVENT_TRUNCATED_PROMPT_LENGTH),
      options: question.options.map((option) => truncateText(option, GAME_EVENT_TRUNCATED_OPTION_LENGTH)),
    })),
  };
  const bytes = jsonBytes(truncated);
  if (bytes <= GAME_EVENT_MAX_BYTES) return { kind: "truncated", event: truncated, bytes, originalBytes };
  return { kind: "too_large", bytes, originalBytes };
}

/** Ukuran yang dihitung terhadap batas Queue: JSON dalam UTF-8. */
function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Dipotong per huruf Unicode (code point lewat Array.from), bukan per unit UTF-16 seperti slice: emoji dan aksara
 * di luar BMP tidak terbelah jadi karakter rusak. Panjang hasil, termasuk "…", tepat maxChars.
 */
export function truncateText(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, maxChars - 1).join("")}…`;
}

/** Jeda sebelum percobaan berikutnya setelah `failedAttempts` kali gagal (minimal 1); berhenti di elemen terakhir. */
export function gameEventRetryDelay(failedAttempts: number): number {
  const steps = GAME_EVENT_RETRY_MS;
  const delay = steps[Math.min(Math.max(failedAttempts, 1), steps.length) - 1];
  if (delay === undefined) throw new Error("GAME_EVENT_RETRY_MS kosong");
  return delay;
}
