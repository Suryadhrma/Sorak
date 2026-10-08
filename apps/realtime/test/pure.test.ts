import { RATE_LIMIT, STALE_SOCKET_MS, SessionToken } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { takeToken, type TokenBucket } from "../src/rate-limit.ts";
import { hashSessionToken, newSessionToken } from "../src/session-token.ts";
import { isStale } from "../src/stale.ts";

describe("isStale", () => {
  const joinedAt = 1_000_000;

  it("memakai pong terbaru sebagai tanda hidup", () => {
    const lastPongAt = joinedAt + 60_000;
    expect(isStale(lastPongAt + STALE_SOCKET_MS, lastPongAt, joinedAt)).toBe(false);
    expect(isStale(lastPongAt + STALE_SOCKET_MS + 1, lastPongAt, joinedAt)).toBe(true);
  });

  it("socket yang belum pernah ping diukur dari saat join", () => {
    expect(isStale(joinedAt + 1_000, null, joinedAt)).toBe(false);
    expect(isStale(joinedAt + STALE_SOCKET_MS + 1, null, joinedAt)).toBe(true);
  });

  it("pong dari sebelum join (socket lama dipakai resume) tidak membuatnya basi", () => {
    expect(isStale(joinedAt + 1_000, joinedAt - 10 * STALE_SOCKET_MS, joinedAt)).toBe(false);
  });
});

describe("takeToken", () => {
  const send = (count: number, now: number, start?: TokenBucket) => {
    let bucket = start;
    const results: boolean[] = [];
    for (let i = 0; i < count; i++) {
      const taken = takeToken(bucket, now);
      bucket = taken.bucket;
      results.push(taken.allowed);
    }
    return { results, bucket };
  };

  it(`menerima ${RATE_LIMIT.capacity} pesan sekaligus, menolak yang berikutnya`, () => {
    const { results } = send(RATE_LIMIT.capacity + 1, 0);
    expect(results.filter(Boolean)).toHaveLength(RATE_LIMIT.capacity);
    expect(results.at(-1)).toBe(false);
  });

  it("terisi ulang seiring waktu, tapi tidak melebihi kapasitas", () => {
    const { bucket } = send(RATE_LIMIT.capacity, 0);
    expect(takeToken(bucket, 1000 / RATE_LIMIT.refillPerSecond).allowed).toBe(true);
    const later = send(RATE_LIMIT.capacity + 1, 60_000, bucket);
    expect(later.results.filter(Boolean)).toHaveLength(RATE_LIMIT.capacity);
  });
});

describe("session token", () => {
  it("lolos skema SessionToken dan selalu berbeda", () => {
    const first = newSessionToken();
    expect(SessionToken.safeParse(first).success).toBe(true);
    expect(first).toHaveLength(22);
    expect(newSessionToken()).not.toBe(first);
  });

  it("hash berupa SHA-256 hex yang stabil", async () => {
    // SHA-256("abc"), vektor uji standar FIPS 180-2.
    expect(await hashSessionToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
