import { useEffect, useRef } from "react";
import { TALLY_GROUP_WIDTH, TALLY_HEIGHT, tallyDrawOrder, tallyMarks } from "./tally.ts";

/**
 * Turus: n garis, diikat per lima. Key setiap garis tetap, jadi saat n bertambah hanya garis baru yang dipasang
 * dan digambar (stroke-dashoffset); garis lama diam. Garis baru digambar berurutan, jeda --gerak-turus-jeda.
 * Urutannya dikirim lewat variabel --urutan, bukan animation-delay langsung: turus "menunggu" (HP-5) memasang
 * jedanya sendiri di CSS, dan style inline akan menimpanya.
 */
export function Tally({ count, label }: { count: number; label: string }) {
  const previous = useRef<number | null>(null);
  const groups = Math.max(1, Math.ceil(count / 5));
  const start = previous.current;

  useEffect(() => {
    previous.current = count;
  }, [count]);

  return (
    <svg className="tally" viewBox={`0 0 ${groups * TALLY_GROUP_WIDTH} ${TALLY_HEIGHT}`} role="img" aria-label={label}>
      {tallyMarks(count).map((mark) => (
        <line
          key={mark.key}
          className={mark.slash ? "tally-mark tally-slash" : "tally-mark"}
          style={{ "--urutan": tallyDrawOrder(start, mark.key) }}
          pathLength={1}
          x1={mark.x1}
          y1={mark.y1}
          x2={mark.x2}
          y2={mark.y2}
        />
      ))}
    </svg>
  );
}
