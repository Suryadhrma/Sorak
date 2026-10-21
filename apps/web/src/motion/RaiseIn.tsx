import type { ReactNode } from "react";

/** Pembungkus kartu jawaban: berputar dari tepi atas saat muncul, jeda 70 ms per kartu. */
export function RaiseIn({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="raise-in" style={{ animationDelay: `calc(var(--gerak-angkat-jeda) * ${index})` }}>
      {children}
    </div>
  );
}
