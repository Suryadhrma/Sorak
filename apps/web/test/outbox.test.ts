import type { PlayerSnapshot } from "@sorak/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideQueuedAnswer, loadQueuedAnswer, saveQueuedAnswer, type QueuedAnswer } from "../src/outbox.ts";
import { installBrowserFakes } from "./fake-websocket.ts";

const question = { q: 2, total: 5, prompt: "Ibu kota Jawa Barat?", options: ["Bandung", "Bogor"], durationMs: 20_000, imageUrl: null };
const queued: QueuedAnswer = { q: 2, choice: 0, elapsedMs: 4200 };

const snapshot = (patch: Partial<PlayerSnapshot>): PlayerSnapshot => ({
  phase: "question",
  question,
  remainingMs: 9000,
  answered: false,
  score: 0,
  streak: 0,
  rank: 1,
  playerCount: 20,
  ...patch,
});

describe("decideQueuedAnswer", () => {
  it.each<[string, Partial<PlayerSnapshot>, "resend" | "drop"]>([
    ["soal yang sama masih berjalan, server belum punya jawabannya", {}, "resend"],
    ["soal yang sama di grace (jawaban masih diterima)", { phase: "grace", remainingMs: null }, "resend"],
    ["server sudah punya jawabannya", { answered: true }, "drop"],
    ["sudah pindah ke soal lain", { question: { ...question, q: 3 } }, "drop"],
    ["sudah reveal", { phase: "reveal", remainingMs: null }, "drop"],
    ["game sudah selesai", { phase: "ended", question: null, remainingMs: null }, "drop"],
  ])("%s -> %s", (_case, patch, decision) => {
    expect(decideQueuedAnswer(snapshot(patch), queued)).toBe(decision);
  });
});

describe("penyimpanan antrean", () => {
  let fakes: ReturnType<typeof installBrowserFakes>;

  beforeEach(() => {
    fakes = installBrowserFakes();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selamat dari muat ulang halaman, terpisah per PIN", () => {
    saveQueuedAnswer("123456", queued);
    expect(loadQueuedAnswer("123456")).toEqual(queued);
    expect(loadQueuedAnswer("654321")).toBeNull();
  });

  it("isi storage yang rusak atau diubah tangan dianggap tidak ada", () => {
    fakes.storage.set("sorak:answer:123456", "{bukan json");
    expect(loadQueuedAnswer("123456")).toBeNull();
    fakes.storage.set("sorak:answer:123456", JSON.stringify({ q: 2, choice: 9, elapsedMs: 100 }));
    expect(loadQueuedAnswer("123456")).toBeNull();
  });
});
