import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { GameEndedEvent } from "@sorak/shared";
import worker from "../src/index.ts";

const validEvent: GameEndedEvent = {
  type: "game_ended",
  v: 1,
  gameId: "6f1c2a3e-8b4d-4c5e-9f6a-7b8c9d0e1f2a",
  hostId: "host-1",
  quizId: null,
  quizTitle: "Kuis IPA",
  pin: "123456",
  scoringMode: "classic",
  teamMode: false,
  startedAt: 1_000,
  endedAt: 2_000,
  players: [],
  questions: [
    {
      position: 0,
      questionId: null,
      prompt: "Planet terbesar?",
      options: ["Mars", "Jupiter"],
      correctIndex: 1,
      answerCounts: [0, 0],
      answeredCount: 0,
      correctCount: 0,
      avgAnswerMs: null,
      confidentWrongCount: 0,
    },
  ],
};

async function consume(body: unknown) {
  const batch = createMessageBatch("sorak-game-events", [{ id: "m1", timestamp: new Date(0), attempts: 1, body }]);
  const ctx = createExecutionContext();
  await worker.queue(batch);
  return getQueueResult(batch, ctx);
}

describe("consumer sorak-game-events", () => {
  it("meng-ack event yang valid", async () => {
    const result = await consume(validEvent);
    expect(result.explicitAcks).toEqual(["m1"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("meng-ack event tidak valid tanpa retry", async () => {
    const result = await consume({ type: "game_ended", v: 1 });
    expect(result.explicitAcks).toEqual(["m1"]);
    expect(result.retryMessages).toEqual([]);
  });
});
