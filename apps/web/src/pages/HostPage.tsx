import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Pin } from "@sorak/shared";
import { createHostSession, type HostSession, type HostView } from "../host-session.ts";

/** Layar proyektor: dibaca dari belakang kelas, jadi PIN dan alamat situs sebesar mungkin. */
export function HostPage() {
  const params = useParams();
  const parsed = Pin.safeParse(params.pin);
  const pin = parsed.success ? parsed.data : null;
  const navigate = useNavigate();
  const [view, setView] = useState<HostView>({ kind: "connecting" });
  const session = useRef<HostSession | null>(null);

  useEffect(() => {
    if (!pin) return;
    const current = createHostSession(pin, setView);
    session.current = current;
    current.start();
    return () => {
      current.stop();
      session.current = null;
    };
  }, [pin]);

  function handleCancel() {
    if (!window.confirm("Batalkan room ini? Semua siswa akan keluar.")) return;
    session.current?.end();
    navigate("/quizzes");
  }

  if (!pin) return <HostEnded message="PIN tidak valid." />;
  if (view.kind === "connecting") {
    return (
      <p className="page-status" role="status">
        Membuka room…
      </p>
    );
  }
  if (view.kind === "ended") {
    return <HostEnded message={view.message} onRetry={view.canRetry ? () => session.current?.start() : undefined} />;
  }

  return (
    <main className="host-screen">
      <p className="host-join-hint">
        Buka <strong>{location.host}</strong> lalu masukkan PIN
      </p>
      <p className="host-pin">
        {pin.slice(0, 3)} {pin.slice(3)}
      </p>
      <p className="host-count" role="status" aria-live="polite">
        {view.players.length} pemain
      </p>
      {view.players.length === 0 ? (
        <p className="empty">Menunggu siswa masuk…</p>
      ) : (
        <ul className="roster">
          {view.players.map((player) => (
            <li key={player.playerId}>{player.nickname}</li>
          ))}
        </ul>
      )}
      <div className="host-actions">
        <button type="button" className="button button-danger" onClick={handleCancel}>
          Batalkan
        </button>
      </div>
    </main>
  );
}

function HostEnded({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }) {
  return (
    <main className="page page-narrow">
      <p className="alert" role="alert">
        {message}
      </p>
      {onRetry && (
        <button type="button" className="button button-primary" onClick={onRetry}>
          Sambung lagi
        </button>
      )}
      <Link className="button" to="/quizzes">
        Kembali ke Kuis saya
      </Link>
    </main>
  );
}
