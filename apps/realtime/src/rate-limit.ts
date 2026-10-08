import { RATE_LIMIT } from "@sorak/shared";

export type TokenBucket = { tokens: number; refilledAt: number };

/**
 * Token bucket: ember berisi paling banyak `capacity` token yang terisi ulang terus-menerus.
 * Setiap pesan mengambil satu token; ember kosong = pengirim terlalu cepat.
 * Bucket baru (undefined) mulai penuh, supaya pesan pembuka tidak pernah ditolak.
 */
export function takeToken(bucket: TokenBucket | undefined, now: number): { allowed: boolean; bucket: TokenBucket } {
  const current = bucket ?? { tokens: RATE_LIMIT.capacity, refilledAt: now };
  const refill = ((now - current.refilledAt) / 1000) * RATE_LIMIT.refillPerSecond;
  const tokens = Math.min(RATE_LIMIT.capacity, current.tokens + refill);
  if (tokens < 1) return { allowed: false, bucket: { tokens, refilledAt: now } };
  return { allowed: true, bucket: { tokens: tokens - 1, refilledAt: now } };
}
