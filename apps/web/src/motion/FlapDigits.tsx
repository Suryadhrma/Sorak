import { useEffect, useRef } from "react";
import { flapDigits } from "./flap.ts";

/**
 * Ubin angka bergaris belah (PIN, poin, peringkat). Digit yang berubah berputar masuk sekali; yang sama diam.
 * Pembaca layar membaca nilainya utuh, bukan per ubin.
 * `delayOffset`: jumlah digit di kelompok sebelumnya (PIN 3 + 3), supaya kelompok kedua berputar setelah yang pertama.
 */
export function FlapDigits({ value, className, delayOffset = 0 }: { value: string; className?: string; delayOffset?: number }) {
  const previous = useRef<string | null>(null);
  const digits = flapDigits(previous.current, value);

  useEffect(() => {
    previous.current = value;
  }, [value]);

  return (
    <span className={className ? `flap ${className}` : "flap"}>
      <span className="visually-hidden">{value}</span>
      <span className="flap-tiles" aria-hidden="true">
        {digits.map((digit) => (
          <span
            key={digit.key}
            className={digit.delayIndex === null ? "flap-digit" : "flap-digit flap-turn"}
            style={digit.delayIndex === null ? undefined : { animationDelay: `calc(var(--gerak-balik-jeda) * ${digit.delayIndex + delayOffset})` }}
          >
            {digit.char}
          </span>
        ))}
      </span>
    </span>
  );
}
