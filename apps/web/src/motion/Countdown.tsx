import { countdownDisplay } from "../countdown.ts";
import { useRemainingMs } from "../useRemainingMs.ts";

/**
 * Hitung mundur: angka besar yang bergulung pendek setiap detik, dan batang waktu (scaleX, bukan width).
 * Detik-detik terakhir berwarna waktu-kritis.
 */
export function Countdown({ startedAt, durationMs, className }: { startedAt: number; durationMs: number; className?: string }) {
  const { seconds, fraction, urgent } = countdownDisplay(useRemainingMs(startedAt, durationMs), durationMs);
  const classes = ["countdown-block", className, urgent ? "is-urgent" : null].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <span className="countdown" role="timer" aria-label={`Sisa waktu ${seconds} detik`}>
        {/* Key per detik: angka baru dipasang ulang, jadi gulungnya berjalan sekali setiap detik. */}
        <span key={seconds} className="countdown-number">
          {seconds}
        </span>
      </span>
      <span className="countdown-track" aria-hidden="true">
        <span className="countdown-bar" style={{ transform: `scaleX(${fraction})` }} />
      </span>
    </div>
  );
}
