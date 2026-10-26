/** Sisa jatah Groq dari header respons terakhir, dengan waktu kapan header itu diterima. */
export type RateInfo = {
  /** x-ratelimit-remaining-tokens: sisa token per menit (TPM). */
  remainingTokens: number | null;
  /** x-ratelimit-reset-tokens dalam ms: kapan jatah TPM penuh lagi. */
  resetTokensMs: number | null;
  /** x-ratelimit-remaining-requests: sisa permintaan per hari (RPD). */
  remainingRequests: number | null;
  /** retry-after (detik), hanya pada 429. */
  retryAfterSec: number | null;
  observedAt: number;
};

// Sedikit lebih lama dari yang diminta header: jam Groq dan jam kita tidak persis sama.
const MARGIN_MS = 1_000;
const FALLBACK_WAIT_MS = 30_000;

/** Durasi gaya Groq ("7.66s", "2m59.56s", "120ms", "1h2m3s") jadi milidetik; null kalau tidak terbaca. */
export function parseGroqDuration(text: string | null): number | null {
  if (!text) return null;
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  const factor: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };
  let total = 0;
  let consumed = 0;
  for (const match of text.matchAll(pattern)) {
    const [whole, amount, unit] = match;
    if (!amount || !unit) return null;
    total += Number(amount) * (factor[unit] ?? 0);
    consumed += whole.length;
  }
  return consumed === text.trim().length && consumed > 0 ? Math.ceil(total) : null;
}

function numberHeader(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readRateInfo(headers: Headers, observedAt: number): RateInfo {
  return {
    remainingTokens: numberHeader(headers, "x-ratelimit-remaining-tokens"),
    resetTokensMs: parseGroqDuration(headers.get("x-ratelimit-reset-tokens")),
    remainingRequests: numberHeader(headers, "x-ratelimit-remaining-requests"),
    retryAfterSec: numberHeader(headers, "retry-after"),
    observedAt,
  };
}

/**
 * Berapa lama menunggu sebelum permintaan berikutnya. Kalau sisa token per menit dari respons terakhir kurang
 * dari perkiraan kebutuhan satu permintaan, tunggu sampai jatahnya pulih; waktu yang sudah lewat sejak header
 * diterima dikurangkan. Tanpa info header (permintaan pertama), langsung jalan.
 */
export function waitBeforeRequest(rate: RateInfo | null, neededTokens: number, now: number): number {
  if (!rate || rate.remainingTokens === null || rate.remainingTokens >= neededTokens) return 0;
  const reset = rate.resetTokensMs ?? FALLBACK_WAIT_MS;
  return Math.max(0, rate.observedAt + reset + MARGIN_MS - now);
}

/** Setelah 429: ikuti retry-after; kalau tidak ada, tunggu jatah TPM pulih; kalau itu pun tidak ada, 30 detik. */
export function waitAfterRateLimit(rate: RateInfo): number {
  if (rate.retryAfterSec !== null && rate.retryAfterSec > 0) return rate.retryAfterSec * 1_000 + MARGIN_MS;
  return (rate.resetTokensMs ?? FALLBACK_WAIT_MS) + MARGIN_MS;
}
