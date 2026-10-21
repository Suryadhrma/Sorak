import type { ReactNode } from "react";

/**
 * Batang sebaran (axis x: tumbuh dari kiri dengan scaleX) dan balok podium (axis y: naik dari bawah dengan
 * translateY). `order` menunda kemunculan; podium memberi juara 1 urutan terakhir.
 */
export function RiseIn({ axis, order = 0, children }: { axis: "x" | "y"; order?: number; children: ReactNode }) {
  return (
    <span className={`rise-in rise-in-${axis}`} style={{ animationDelay: `calc(var(--gerak-naik-jeda) * ${order})` }}>
      {children}
    </span>
  );
}
