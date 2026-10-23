import {
  CHEER_HOST_THROTTLE_MS,
  CHEER_LIMIT,
  CHEER_PLAYER_THROTTLE_MS,
  CHEER_RECENT_MAX,
  RATE_LIMIT,
  STALE_SOCKET_MS,
  SessionToken,
} from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { addCheer, emptyCheer, type CheerState } from "../src/cheer.ts";
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

describe("ember sorak", () => {
  it(`6 sorak cepat -> ${CHEER_LIMIT.capacity} diterima, lalu satu terisi lagi setiap ${1000 / CHEER_LIMIT.refillPerSecond} ms`, () => {
    let bucket: TokenBucket | undefined;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const taken = takeToken(bucket, 0, CHEER_LIMIT);
      bucket = taken.bucket;
      results.push(taken.allowed);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(takeToken(bucket, 1000 / CHEER_LIMIT.refillPerSecond, CHEER_LIMIT).allowed).toBe(true);
  });
});

describe("addCheer (leading-edge throttle)", () => {
  const cheerAt = (state: CheerState, times: number[], nickname = "Rara") => {
    const outcomes = [];
    for (const now of times) {
      const outcome = addCheer(state, nickname, now);
      state = outcome.state;
      outcomes.push(outcome);
    }
    return outcomes;
  };

  it("sorak pertama langsung ke host dan pemain", () => {
    const [first] = cheerAt(emptyCheer, [1_000]);
    expect(first?.toHost).toEqual({ total: 1, recent: ["Rara"] });
    expect(first?.toPlayers).toEqual({ total: 1 });
  });

  it("beberapa sorak dalam 300 ms -> satu cheer; kiriman berikutnya membawa total dan penyorak di sela jeda", () => {
    const outcomes = cheerAt(emptyCheer, [0, 100, 200, CHEER_HOST_THROTTLE_MS]);
    expect(outcomes.map((outcome) => outcome.toHost?.total ?? null)).toEqual([1, null, null, 4]);
    expect(outcomes[3]?.toHost?.recent).toEqual(["Rara", "Rara", "Rara"]);
  });

  it(`cheer_total ke pemain paling cepat tiap ${CHEER_PLAYER_THROTTLE_MS} ms`, () => {
    const outcomes = cheerAt(emptyCheer, [0, 500, 1_000, CHEER_PLAYER_THROTTLE_MS]);
    expect(outcomes.map((outcome) => outcome.toPlayers?.total ?? null)).toEqual([1, null, null, 4]);
  });

  it(`penyorak terakhir dibatasi ${CHEER_RECENT_MAX} nama`, () => {
    let state = emptyCheer;
    state = addCheer(state, "A", 0).state;
    for (const nickname of ["B", "C", "D", "E", "F", "G"]) state = addCheer(state, nickname, 10).state;
    expect(addCheer(state, "H", CHEER_HOST_THROTTLE_MS).toHost?.recent).toEqual(["D", "E", "F", "G", "H"]);
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
