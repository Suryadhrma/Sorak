import { describe, expect, it } from "vitest";
import { parseGroqDuration, readRateInfo, waitAfterRateLimit, waitBeforeRequest, type RateInfo } from "../src/pacing.ts";

const rate = (extra: Partial<RateInfo> = {}): RateInfo => ({
  remainingTokens: 8_000,
  resetTokensMs: 0,
  remainingRequests: 999,
  retryAfterSec: null,
  observedAt: 10_000,
  ...extra,
});

describe("parseGroqDuration", () => {
  it.each([
    ["7.66s", 7_660],
    ["2m59.56s", 179_560],
    ["120ms", 120],
    ["1h2m3s", 3_723_000],
  ])("%s -> %i ms", (text, ms) => {
    expect(parseGroqDuration(text)).toBe(ms);
  });

  it("teks yang tidak terbaca atau kosong -> null", () => {
    expect(parseGroqDuration(null)).toBeNull();
    expect(parseGroqDuration("")).toBeNull();
    expect(parseGroqDuration("besok")).toBeNull();
    expect(parseGroqDuration("7.66s lalu")).toBeNull();
  });
});

describe("readRateInfo", () => {
  it("membaca header rate limit Groq", () => {
    const headers = new Headers({
      "x-ratelimit-remaining-tokens": "3120",
      "x-ratelimit-reset-tokens": "36.6s",
      "x-ratelimit-remaining-requests": "987",
      "retry-after": "4",
    });
    expect(readRateInfo(headers, 5)).toEqual({
      remainingTokens: 3_120,
      resetTokensMs: 36_600,
      remainingRequests: 987,
      retryAfterSec: 4,
      observedAt: 5,
    });
  });

  it("header yang tidak ada -> null", () => {
    expect(readRateInfo(new Headers(), 0)).toMatchObject({ remainingTokens: null, resetTokensMs: null, retryAfterSec: null });
  });
});

describe("waitBeforeRequest", () => {
  it("tanpa info header (permintaan pertama) atau sisa token cukup: langsung jalan", () => {
    expect(waitBeforeRequest(null, 5_000, 0)).toBe(0);
    expect(waitBeforeRequest(rate({ remainingTokens: 5_000 }), 5_000, 10_000)).toBe(0);
  });

  it("sisa token kurang: tunggu sampai jatah pulih, dikurangi waktu yang sudah lewat, plus jeda 1 detik", () => {
    const low = rate({ remainingTokens: 3_000, resetTokensMs: 30_000 });
    expect(waitBeforeRequest(low, 5_000, 10_000)).toBe(31_000);
    expect(waitBeforeRequest(low, 5_000, 25_000)).toBe(16_000);
    expect(waitBeforeRequest(low, 5_000, 60_000)).toBe(0);
  });
});

describe("waitAfterRateLimit", () => {
  it("ikut retry-after; tanpa itu, tunggu jatah token pulih; tanpa keduanya 30 detik", () => {
    expect(waitAfterRateLimit(rate({ retryAfterSec: 12 }))).toBe(13_000);
    expect(waitAfterRateLimit(rate({ resetTokensMs: 7_660 }))).toBe(8_660);
    expect(waitAfterRateLimit(rate({ resetTokensMs: null }))).toBe(31_000);
  });
});
