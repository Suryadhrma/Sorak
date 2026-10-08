import { useEffect, useState } from "react";
import { remainingMs } from "./countdown.ts";

const TICK_MS = 250;

/** Sisa waktu soal yang diperbarui beberapa kali per detik, berbasis performance.now (bukan jam HP). */
export function useRemainingMs(startedAt: number, durationMs: number): number {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [startedAt]);

  return remainingMs(startedAt, durationMs, now);
}
