/**
 * Ubin angka FlapDigits: digit yang berubah mendapat key baru (dipasang ulang, jadi animasinya berputar sekali),
 * digit yang sama tetap diam. Dibandingkan dari kanan supaya satuan sejajar satuan saat jumlah digit berubah.
 */

export type FlapDigit = {
  char: string;
  key: string;
  /** Urutan di antara digit yang berputar (untuk jeda 60 ms per digit); null kalau digit ini tidak berubah. */
  delayIndex: number | null;
};

/** previous null: layar baru, semua digit berputar masuk. */
export function flapDigits(previous: string | null, next: string): FlapDigit[] {
  const chars = Array.from(next);
  const before = previous === null ? null : Array.from(previous);
  let animated = 0;
  return chars.map((char, index) => {
    const fromRight = chars.length - 1 - index;
    const old = before?.[before.length - 1 - fromRight];
    const changed = before === null || old !== char;
    return { char, key: `${fromRight}:${char}`, delayIndex: changed ? animated++ : null };
  });
}
