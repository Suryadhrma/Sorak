import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Pin } from "@sorak/shared";

/** Halaman pertama siswa: cukup PIN. Nickname ditanya setelah PIN terbukti ada. */
export function JoinPage() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Pin.safeParse(pin);
    if (!parsed.success) {
      setError("PIN terdiri dari 6 angka.");
      return;
    }
    navigate(`/play/${parsed.data}`);
  }

  return (
    <main className="page page-narrow">
      <h1>Sorak</h1>
      <form className="join-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="pin">PIN dari guru</label>
          <input
            id="pin"
            className="pin-input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            // HP kadang menyisipkan spasi atau tanda baca saat menempel; yang dipakai hanya angkanya.
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            {...(error ? { "aria-invalid": true, "aria-describedby": "pin-error" } : {})}
          />
          {error && (
            <p id="pin-error" className="field-error">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="button button-primary button-block">
          Masuk
        </button>
      </form>
      <Link className="muted" to="/login">
        Masuk sebagai guru
      </Link>
    </main>
  );
}
