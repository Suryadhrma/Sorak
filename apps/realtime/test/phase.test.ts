import { describe, expect, it } from "vitest";
import { nextPhase } from "../src/phase.ts";

describe("nextPhase", () => {
  it.each([
    ["lobby", "start", "question"],
    ["lobby", "end", "cancelled"],
    ["lobby", "idle_timeout", "cancelled"],
    ["question", "deadline", "grace"],
    ["question", "all_answered", "grace"],
    ["grace", "grace_over", "reveal"],
    ["reveal", "next", "question"],
    ["reveal", "next_last", "ended"],
    ["reveal", "idle_timeout", "ended"],
    ["question", "end", "ended"],
    ["grace", "end", "ended"],
    ["reveal", "end", "ended"],
    ["ended", "retention_over", "closed"],
  ] as const)("%s + %s -> %s", (phase, event, target) => {
    expect(nextPhase(phase, event)).toBe(target);
  });

  it.each([
    ["question", "next"],
    ["reveal", "deadline"],
    ["lobby", "grace_over"],
    ["grace", "all_answered"],
    ["question", "start"],
    ["ended", "end"],
    ["ended", "next"],
  ] as const)("%s + %s tidak sah", (phase, event) => {
    expect(nextPhase(phase, event)).toBeNull();
  });
});
