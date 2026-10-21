import { TALLY_GROUP_WIDTH, TALLY_HEIGHT, tallyMarks } from "./tally.ts";

/**
 * Turus: n garis, diikat per lima. Key setiap garis tetap, jadi saat n bertambah hanya garis baru yang dipasang
 * dan digambar (stroke-dashoffset); garis lama diam.
 */
export function Tally({ count, label }: { count: number; label: string }) {
  const groups = Math.max(1, Math.ceil(count / 5));
  return (
    <svg className="tally" viewBox={`0 0 ${groups * TALLY_GROUP_WIDTH} ${TALLY_HEIGHT}`} role="img" aria-label={label}>
      {tallyMarks(count).map((mark) => (
        <line
          key={mark.key}
          className={mark.slash ? "tally-mark tally-slash" : "tally-mark"}
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
