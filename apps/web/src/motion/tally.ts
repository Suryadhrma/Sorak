/**
 * Geometri turus: setiap ikat berisi 4 garis tegak dan 1 garis miring (ikat ke-5). Satuan viewBox SVG, sama
 * dengan board Gerak dan Logo.
 */

export const TALLY_GROUP_WIDTH = 100;
export const TALLY_HEIGHT = 90;

export type TallyMark = { key: number; x1: number; y1: number; x2: number; y2: number; slash: boolean };

const LINE_GAP = 18;
const FIRST_LINE_X = 22;
const TOP = 10;
const BOTTOM = 80;

export function tallyMarks(count: number): TallyMark[] {
  return Array.from({ length: Math.max(0, count) }, (_, key) => {
    const group = Math.floor(key / 5);
    const offset = group * TALLY_GROUP_WIDTH;
    const slash = key % 5 === 4;
    if (slash) return { key, x1: offset + 10, y1: BOTTOM - 8, x2: offset + 88, y2: TOP + 8, slash };
    const x = offset + FIRST_LINE_X + (key % 5) * LINE_GAP;
    return { key, x1: x, y1: TOP, x2: x, y2: BOTTOM, slash };
  });
}
