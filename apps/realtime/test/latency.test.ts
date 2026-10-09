import { LATENCY_EPSILON_MS, MAX_ONE_WAY_LATENCY_MS } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { compensateAnswerTime, updateLatency } from "../src/latency.ts";

describe("updateLatency", () => {
  it("sampel pertama = setengah RTT", () => {
    expect(updateLatency(null, 200)).toBe(100);
  });

  it("deret sampel mengikuti EWMA alfa 0,3 (dihitung tangan)", () => {
    // 200 -> 100; 600 -> 0,7 x 100 + 0,3 x 300 = 160; 100 -> 0,7 x 160 + 0,3 x 50 = 127.
    const first = updateLatency(null, 200);
    const second = updateLatency(first, 600);
    const third = updateLatency(second, 100);
    expect([first, second, third]).toEqual([100, 160, 127]);
  });

  it(`RTT 5000 ms dibatasi ${MAX_ONE_WAY_LATENCY_MS} ms`, () => {
    expect(updateLatency(null, 5000)).toBe(MAX_ONE_WAY_LATENCY_MS);
    expect(updateLatency(MAX_ONE_WAY_LATENCY_MS, 5000)).toBe(MAX_ONE_WAY_LATENCY_MS);
  });

  it("RTT negatif adalah bug: dilempar, bukan diperbaiki diam-diam", () => {
    expect(() => updateLatency(null, -1)).toThrow();
  });
});

describe("compensateAnswerTime", () => {
  const T = 10_000;
  const answer = (elapsedMs: number, tServerMs: number, latencyMs: number | null) =>
    compensateAnswerTime({ elapsedMs, tServerMs, latencyMs, timeLimitMs: T });

  it("klaim jujur di dalam rentang dipakai apa adanya", () => {
    // tServer 3200, d 100: rentang 3200 - 200 - 150 = 2850 sampai 3200.
    expect(answer(3000, 3200, 100)).toBe(3000);
  });

  it("klaim 0 ms dipotong ke batas bawah", () => {
    expect(answer(0, 3200, 100)).toBe(3200 - 2 * 100 - LATENCY_EPSILON_MS);
  });

  it("klaim lebih besar dari tServer dipotong ke tServer", () => {
    expect(answer(5000, 3200, 100)).toBe(3200);
  });

  it("belum pernah ack (latency null): diperlakukan d = 0, tanpa kelonggaran tambahan", () => {
    expect(answer(3000, 3200, null)).toBe(3200 - LATENCY_EPSILON_MS);
  });

  it("tidak pernah di atas T dan tidak pernah negatif", () => {
    expect(answer(11_000, 12_000, 100)).toBe(T);
    expect(answer(0, 100, MAX_ONE_WAY_LATENCY_MS)).toBe(0);
  });
});
