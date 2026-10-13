import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { GameEndedEvent } from "@sorak/shared";
import worker from "../src/index.ts";

/** Event game_ended yang valid: `players` pemain dan `questions` soal milik host `hostId`. */
export function gameEvent(hostId: string, options: { players?: number; questions?: number; endedAt?: number } = {}): GameEndedEvent {
  const endedAt = options.endedAt ?? Date.now();
  return {
    type: "game_ended",
    v: 1,
    gameId: crypto.randomUUID(),
    hostId,
    quizId: null,
    quizTitle: "Kuis IPA",
    pin: "123456",
    scoringMode: "classic",
    teamMode: false,
    startedAt: endedAt - 600_000,
    endedAt,
    players: Array.from({ length: options.players ?? 3 }, (_, i) => ({
      playerId: crypto.randomUUID(),
      nickname: `Pemain ${i + 1}`,
      teamSize: null,
      finalScore: 10_000 - i * 10,
      finalRank: i + 1,
      correctCount: 2,
      answeredCount: 3,
      highlights: { bestStreak: 2, confidentCorrect: 0, biggestRankClimb: 0, fastestCorrectMs: 1500 },
    })),
    questions: Array.from({ length: options.questions ?? 2 }, (_, position) => ({
      position,
      questionId: crypto.randomUUID(),
      prompt: `Soal ${position + 1}?`,
      options: ["Mars", "Jupiter", "Venus", "Bumi"],
      correctIndex: 1,
      answerCounts: [1, 2, 0, 0],
      answeredCount: 3,
      correctCount: 2,
      avgAnswerMs: 4200,
      confidentWrongCount: 0,
    })),
  };
}

/** Satu pesan Queue ke consumer, seperti yang dikirim GameRoom; `attempts` dimulai 1. */
export async function consume(body: unknown, attempts = 1) {
  const batch = createMessageBatch("sorak-game-events", [{ id: "m1", timestamp: new Date(), attempts, body }]);
  const ctx = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, ctx);
}

/** Jumlah baris satu game di ketiga tabel hasil. */
export async function storedRows(gameId: string) {
  const [games, players, stats] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE id = ?").bind(gameId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?").bind(gameId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM game_question_stats WHERE game_id = ?").bind(gameId),
  ]);
  return { games: games?.results[0]?.n, players: players?.results[0]?.n, stats: stats?.results[0]?.n };
}
