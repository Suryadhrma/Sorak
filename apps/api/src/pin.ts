import type { Pin } from "@sorak/shared";

const PIN_COUNT = 1_000_000;
/**
 * Kelipatan PIN_COUNT terbesar di bawah 2^32 (4.294.000.000). Angka acak di atasnya dibuang (rejection
 * sampling). Tanpa ini `% PIN_COUNT` sedikit lebih sering menghasilkan PIN kecil (modulo bias).
 */
export const UNBIASED_LIMIT = Math.floor(2 ** 32 / PIN_COUNT) * PIN_COUNT;

/** Membuat PIN 6 digit dengan peluang sama untuk setiap angka. PIN boleh diawali nol. */
export function newPin(randomUint32: () => number = cryptoUint32): Pin {
  for (;;) {
    const value = randomUint32();
    if (value < UNBIASED_LIMIT) return String(value % PIN_COUNT).padStart(6, "0");
  }
}

function cryptoUint32(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
  return value;
}
