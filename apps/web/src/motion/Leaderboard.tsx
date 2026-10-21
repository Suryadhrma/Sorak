import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { LeaderboardEntry } from "@sorak/shared";
import { leaderboardMoves } from "./flip.ts";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Papan skor dengan FLIP: React merender urutan baru (Last), setiap baris digeser kembali ke posisi lamanya
 * dengan transform (Invert), lalu transform dilepas sehingga baris meluncur ke tempat barunya (Play).
 * Posisi lama (First) dari leaderboard reveal sebelumnya: posisinya di daftar dikali tinggi satu baris.
 * Yang dianimasikan hanya transform, jadi tata letak tidak dihitung ulang setiap frame.
 */
export function Leaderboard(props: {
  entries: readonly LeaderboardEntry[];
  previous: readonly LeaderboardEntry[] | null;
  renderRow: (entry: LeaderboardEntry) => ReactNode;
}) {
  const { entries, previous } = props;
  const list = useRef<HTMLOListElement | null>(null);
  const moves = leaderboardMoves(previous, entries);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element || reducedMotion()) return;
    const rows = Array.from(element.querySelectorAll<HTMLElement>(":scope > li"));
    const [first, second] = rows;
    if (!first) return;
    const pitch = second ? second.offsetTop - first.offsetTop : first.offsetHeight;
    const shifts = leaderboardMoves(previous, entries);

    rows.forEach((row, index) => {
      const shiftRows = shifts[index]?.shiftRows ?? 0;
      if (shiftRows === 0) return;
      row.style.transition = "none";
      row.style.transform = `translateY(${shiftRows * pitch}px)`;
    });
    // Paksa browser mencatat posisi terbalik dulu, supaya pelepasan transform di bawah benar-benar beranimasi.
    element.getBoundingClientRect();
    for (const row of rows) {
      row.style.transition = "";
      row.style.transform = "";
    }
  }, [entries, previous]);

  return (
    <ol ref={list} className="leaderboard">
      {entries.map((entry, index) => (
        <li key={entry.playerId} className={moves[index]?.rose ? "leaderboard-item is-rising" : "leaderboard-item"}>
          {props.renderRow(entry)}
        </li>
      ))}
    </ol>
  );
}
