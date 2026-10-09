import {
  LEADERBOARD_SIZE,
  nicknameKey,
  type LeaderboardEntry,
  type PendingAnswer,
  type PlayerScore,
  type QuestionStats,
  type Roster,
  type Scoreboard,
  type StoredQuestion,
} from "@sorak/shared";
import { scoreAnswer, type ScoredMode } from "./scoring.ts";

/**
 * Membuka kunci satu soal: menilai jawaban, memperbarui scoreboard, dan menyusun peringkat.
 * Fungsi murni (tanpa storage, socket, atau jam), jadi GameRoom tinggal menulis hasilnya dan mengirim pesan.
 */

export type Outcome = "correct" | "wrong" | "no_answer";

/** Bahan pesan `result` untuk satu pemain. */
export type PlayerResult = { playerId: string; outcome: Outcome; points: number; score: number; rank: number; streak: number };

export type RevealInput = {
  question: StoredQuestion;
  questionIndex: number;
  mode: ScoredMode;
  roster: Roster;
  scoreboard: Scoreboard;
  /** Dari attachment socket yang terbuka dan dari key pending; satu pemain bisa muncul dua kali. */
  answers: readonly PendingAnswer[];
};

export type RevealOutput = {
  scoreboard: Scoreboard;
  stats: QuestionStats;
  results: PlayerResult[];
  /** Maksimal LEADERBOARD_SIZE; delta = poin soal ini. */
  leaderboard: LeaderboardEntry[];
};

export function emptyScore(): PlayerScore {
  return {
    score: 0,
    streak: 0,
    bestStreak: 0,
    correct: 0,
    answered: 0,
    confidentCorrect: 0,
    fastestCorrectMs: null,
    worstRank: null,
    biggestRankClimb: 0,
    lastPoints: 0,
    lastOutcome: null,
  };
}

/**
 * Semua pemain roster, urut skor terbesar. Skor sama mendapat peringkat sama (competition ranking: 1, 2, 2, 4);
 * urutan tampilnya ditentukan nickname supaya selalu sama (deterministik). Dipakai juga untuk mengirim ulang
 * reveal dan podium dari storage.
 */
export function rankPlayers(roster: Roster, scoreboard: Scoreboard): LeaderboardEntry[] {
  const entries = roster.map((player) => {
    const score = scoreboard[player.playerId] ?? emptyScore();
    return { player, score, key: nicknameKey(player.nickname) };
  });
  entries.sort((a, b) => b.score.score - a.score.score || compareText(a.key, b.key) || compareText(a.player.playerId, b.player.playerId));

  return entries.map(({ player, score }) => ({
    playerId: player.playerId,
    nickname: player.nickname,
    teamSize: player.teamSize,
    score: score.score,
    delta: score.lastPoints,
    rank: 1 + entries.filter((other) => other.score.score > score.score).length,
  }));
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function revealQuestion(input: RevealInput): RevealOutput {
  const { question, questionIndex, mode, roster } = input;
  const timeLimitMs = question.timeLimitSec * 1000;
  const answerOf = firstAnswerPerPlayer(input.answers, questionIndex);
  const stats: QuestionStats = {
    answerCounts: question.options.map(() => 0),
    answered: 0,
    correct: 0,
    totalCorrectMs: 0,
    confidentWrong: 0,
  };

  const scored: Scoreboard = {};
  for (const player of roster) {
    const previous = input.scoreboard[player.playerId] ?? emptyScore();
    const answer = answerOf.get(player.playerId);
    const correct = answer?.choice === question.correctIndex;
    const { points, streak } = scoreAnswer({ mode, correct, tMs: answer?.tMs ?? timeLimitMs, timeLimitMs, previousStreak: previous.streak });

    if (answer) {
      stats.answered += 1;
      stats.answerCounts[answer.choice] = (stats.answerCounts[answer.choice] ?? 0) + 1;
    }
    if (answer && correct) {
      stats.correct += 1;
      stats.totalCorrectMs += answer.tMs;
    }

    const fastest = correct && answer ? minOrNull(previous.fastestCorrectMs, answer.tMs) : previous.fastestCorrectMs;
    scored[player.playerId] = {
      ...previous,
      // Skor total tidak pernah di bawah 0, walaupun poin per soal boleh negatif (Taruhan Yakin, Hari 7).
      score: Math.max(0, previous.score + points),
      streak,
      bestStreak: Math.max(previous.bestStreak, streak),
      correct: previous.correct + (correct ? 1 : 0),
      answered: previous.answered + (answer ? 1 : 0),
      fastestCorrectMs: fastest,
      // Tidak menjawab = 0, bukan poin soal sebelumnya.
      lastPoints: points,
      lastOutcome: outcomeOf(answer, correct),
    };
  }

  const ranked = rankPlayers(roster, scored);
  const rankOf = new Map(ranked.map((entry) => [entry.playerId, entry.rank]));
  const scoreboard: Scoreboard = {};
  const results: PlayerResult[] = [];
  for (const player of roster) {
    const current = scored[player.playerId] ?? emptyScore();
    const rank = rankOf.get(player.playerId) ?? roster.length;
    // Peringkat terburuk termasuk soal ini, lalu lompatan terbesar dari peringkat terburuk itu.
    const worstRank = Math.max(current.worstRank ?? rank, rank);
    const score = { ...current, worstRank, biggestRankClimb: Math.max(current.biggestRankClimb, worstRank - rank) };
    scoreboard[player.playerId] = score;
    results.push({
      playerId: player.playerId,
      outcome: score.lastOutcome ?? "no_answer",
      points: score.lastPoints,
      score: score.score,
      rank,
      streak: score.streak,
    });
  }

  return { scoreboard, stats, results, leaderboard: ranked.slice(0, LEADERBOARD_SIZE) };
}

/** Jawaban soal ini per pemain; duplikat (attachment + pending) dan jawaban soal lain diabaikan. */
function firstAnswerPerPlayer(answers: readonly PendingAnswer[], questionIndex: number): Map<string, PendingAnswer> {
  const byPlayer = new Map<string, PendingAnswer>();
  for (const answer of answers) {
    if (answer.q !== questionIndex || byPlayer.has(answer.playerId)) continue;
    byPlayer.set(answer.playerId, answer);
  }
  return byPlayer;
}

function outcomeOf(answer: PendingAnswer | undefined, correct: boolean): Outcome {
  if (!answer) return "no_answer";
  return correct ? "correct" : "wrong";
}

function minOrNull(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}
