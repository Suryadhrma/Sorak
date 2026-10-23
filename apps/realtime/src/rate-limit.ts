import { RATE_LIMIT } from "@sorak/shared";

export type TokenBucket = { tokens: number; refilledAt: number };
export type BucketLimit = { capacity: number; refillPerSecond: number };

/**
 * Token bucket: ember berisi paling banyak `capacity` token yang terisi ulang terus-menerus.
 * Setiap pesan mengambil satu token; ember kosong = pengirim terlalu cepat.
 * Bucket baru (undefined) mulai penuh, supaya pesan pembuka tidak pernah ditolak.
 * `limit` bawaan = batas pesan umum; ember sorak memakai CHEER_LIMIT.
 */
export function takeToken(
  bucket: TokenBucket | undefined,
  now: number,
  limit: BucketLimit = RATE_LIMIT,
): { allowed: boolean; bucket: TokenBucket } {
  const current = bucket ?? { tokens: limit.capacity, refilledAt: now };
  const refill = ((now - current.refilledAt) / 1000) * limit.refillPerSecond;
  const tokens = Math.min(limit.capacity, current.tokens + refill);
  if (tokens < 1) return { allowed: false, bucket: { tokens, refilledAt: now } };
  return { allowed: true, bucket: { tokens: tokens - 1, refilledAt: now } };
}
