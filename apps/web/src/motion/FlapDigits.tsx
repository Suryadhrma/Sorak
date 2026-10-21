import { useEffect, useRef } from "react";
import { flapDigits } from "./flap.ts";

/**
 * Ubin angka bergaris belah (PIN, poin, peringkat). Digit yang berubah berputar masuk sekali; yang sama diam.
 * Pembaca layar membaca nilainya utuh, bukan per ubin.
 */
export function FlapDigits({ value, className }: { value: string; className?: string }) {
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
            style={digit.delayIndex === null ? undefined : { animationDelay: `calc(var(--gerak-balik-jeda) * ${digit.delayIndex})` }}
          >
            {digit.char}
          </span>
        ))}
      </span>
    </span>
  );
}
