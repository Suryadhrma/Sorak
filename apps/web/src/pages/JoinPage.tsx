import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Pin } from "@sorak/shared";
import { Logo } from "../Logo.tsx";
import { useTheme } from "../theme.ts";

const PIN_LENGTH = 6;
const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * Halaman pertama siswa: PIN lewat keypad di layar (board HP-1). Keyboard HP tidak muncul, jadi tata letak tidak
 * terdorong; keyboard fisik di laptop tetap diterima. Nickname ditanya setelah PIN terbukti ada.
 */
export function JoinPage() {
  useTheme("papan");
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const type = (digit: string) => {
    setError(null);
    setPin((current) => (current.length < PIN_LENGTH ? current + digit : current));
  };
  const erase = () => {
    setError(null);
    setPin((current) => current.slice(0, -1));
  };

  function submit() {
    const parsed = Pin.safeParse(pin);
    if (!parsed.success) {
      setError("PIN terdiri dari 6 angka.");
      return;
    }
    navigate(`/play/${parsed.data}`);
  }

  // Tanpa daftar dependensi: dipasang ulang setiap render supaya Enter memakai PIN terbaru.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^\d$/.test(event.key)) type(event.key);
      else if (event.key === "Backspace") erase();
      else if (event.key === "Enter") submit();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const digits = Array.from(pin);
  return (
    <main className="hp-screen">
      <Logo />
      <h1 className="hp-title">Masukkan PIN dari layar guru</h1>
      <p className="muted">Enam angka yang tertulis besar di depan kelas.</p>

      <p className="pin-tiles" aria-hidden="true">
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const digit = digits[index];
          // Key per posisi dan angka: hanya ubin yang baru diisi yang berputar masuk.
          return digit === undefined ? (
            <span key={`kosong-${index}`} className="flap-digit pin-tile pin-tile-empty" />
          ) : (
            <span key={`${index}:${digit}`} className="flap-digit flap-turn pin-tile">
              {digit}
            </span>
          );
        })}
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">
        {digits.length === 0 ? "PIN masih kosong" : `PIN ${digits.join(" ")}`}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="keypad">
        {KEYPAD_DIGITS.map((digit) => (
          <button key={digit} type="button" className="keypad-key" aria-label={`Angka ${digit}`} onClick={() => type(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" className="keypad-key keypad-text" aria-label="Hapus angka terakhir" onClick={erase}>
          Hapus
        </button>
        <button type="button" className="keypad-key" aria-label="Angka 0" onClick={() => type("0")}>
          0
        </button>
        <button type="button" className="keypad-key keypad-enter" aria-label="Masuk dengan PIN ini" onClick={submit}>
          Masuk
        </button>
      </div>

      <p className="muted hp-footnote">
        Kamu guru? <Link to="/login">Buka Sorak di laptop</Link> untuk membuat kuis.
      </p>
    </main>
  );
}
