import { LATENCY_EPSILON_MS } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { compensateAnswerTime, updateLatency } from "../src/latency.ts";
import { scoreAnswer } from "../src/scoring.ts";

/**
 * Simulasi keadilan tanpa WebSocket: server mengirim soal di t = 0 (jam server), HP menerimanya setelah
 * jeda satu arah + jitter, langsung mengirim ack, lalu menjawab setelah waktu reaksinya.
 */

const T = 10_000;
const QUESTIONS = 5;
const JITTER_MS = 100;

/** Pembangkit acak dengan seed tetap (mulberry32), supaya jitter selalu sama di setiap run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Player = { oneWayMs: number; reactionMs: number; claimMs?: number };
type Formula = "compensated" | "server_clock";

function playGame(
  player: Player,
  formula: Formula,
  random: () => number,
  jitterMs = JITTER_MS,
): { total: number; times: number[] } {
  const jitter = () => (random() * 2 - 1) * jitterMs;
  let latencyMs: number | null = null;
  let streak = 0;
  let total = 0;
  const times: number[] = [];

  for (let q = 0; q < QUESTIONS; q++) {
    const questionArrives = player.oneWayMs + jitter();
    const ackArrives = questionArrives + player.oneWayMs + jitter();
    latencyMs = updateLatency(latencyMs, Math.round(ackArrives));

    const answerArrives = questionArrives + player.reactionMs + player.oneWayMs + jitter();
    const tServerMs = Math.round(answerArrives);
    const elapsedMs = player.claimMs ?? player.reactionMs;
    const tMs =
      formula === "compensated"
        ? compensateAnswerTime({ elapsedMs, tServerMs, latencyMs, timeLimitMs: T })
        : Math.min(tServerMs, T);

    const scored = scoreAnswer({ mode: "classic", correct: true, tMs, timeLimitMs: T, previousStreak: streak });
    streak = scored.streak;
    total += scored.points;
    times.push(tMs);
  }
  return { total, times };
}

const gap = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b);

describe("keadilan latency (Klasik, T = 10 detik, 5 soal, reaksi identik 3 detik)", () => {
  const fast: Player = { oneWayMs: 50, reactionMs: 3000 };
  const slow: Player = { oneWayMs: 800, reactionMs: 3000 };

  it("dengan kompensasi: selisih skor 50 ms vs 800 ms di bawah 5%", () => {
    const a = playGame(fast, "compensated", seededRandom(1));
    const b = playGame(slow, "compensated", seededRandom(2));
    const difference = gap(a.total, b.total);
    console.info(`dengan kompensasi: A ${a.total}, B ${b.total}, selisih ${(difference * 100).toFixed(2)}%`);
    expect(difference).toBeLessThan(0.05);
  });

  it("pembanding: dengan jam server saja (rumus Hari 3) selisihnya di atas 5%", () => {
    const a = playGame(fast, "server_clock", seededRandom(1));
    const b = playGame(slow, "server_clock", seededRandom(2));
    const difference = gap(a.total, b.total);
    console.info(`tanpa kompensasi: A ${a.total}, B ${b.total}, selisih ${(difference * 100).toFixed(2)}%`);
    expect(difference).toBeGreaterThan(0.05);
  });

  it(`curang (klaim 0 ms): keuntungannya paling banyak ${LATENCY_EPSILON_MS} ms dibanding pemain jujur dengan jeda sama`, () => {
    // Pemain C bereaksi di 250 ms tapi mengklaim 0. Batas bawah clamp (tServer - 2d - epsilon) memotong
    // klaimnya; yang tersisa hanya margin epsilon. Jadi C tidak boleh lebih baik dari pemain jujur yang benar-benar
    // menjawab di 250 - epsilon ms. Tanpa jitter, supaya yang diuji sifat rumusnya, bukan urutan acak.
    const cheater = playGame({ oneWayMs: 50, reactionMs: 250, claimMs: 0 }, "compensated", seededRandom(3), 0);
    const honestAtBound = playGame({ oneWayMs: 50, reactionMs: 250 - LATENCY_EPSILON_MS }, "compensated", seededRandom(3), 0);
    const honest = playGame({ oneWayMs: 50, reactionMs: 250 }, "compensated", seededRandom(3), 0);
    console.info(`curang: C ${cheater.total}, jujur 250 ms ${honest.total}, jujur ${250 - LATENCY_EPSILON_MS} ms ${honestAtBound.total}`);
    expect(cheater.total).toBeLessThanOrEqual(honestAtBound.total);
    for (const tMs of cheater.times) expect(tMs).toBeGreaterThan(0);
  });
});
