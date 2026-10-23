import { CHEER_ENERGY_MAX, CHEER_ENERGY_REFILL_MS, COUNTDOWN_URGENT_SEC, type LeaderboardEntry } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { energyLevel, fullEnergy, spendCheer } from "../src/cheer-energy.ts";
import { countdownDisplay } from "../src/countdown.ts";
import { flapDigits } from "../src/motion/flap.ts";
import { leaderboardMoves } from "../src/motion/flip.ts";
import { MAX_ROW_ORDER, rowOrder } from "../src/motion/row-order.ts";
import { TALLY_GROUP_WIDTH, tallyDrawOrder, tallyMarks } from "../src/motion/tally.ts";

describe("tallyMarks", () => {
  it.each([
    [0, 0, 0],
    [4, 4, 0],
    [5, 5, 1],
    [6, 6, 1],
    [27, 27, 5],
  ])("n = %i -> %i garis, %i di antaranya miring", (count, lines, slashes) => {
    const marks = tallyMarks(count);
    expect(marks).toHaveLength(lines);
    expect(marks.filter((mark) => mark.slash)).toHaveLength(slashes);
  });

  it("garis miring adalah garis ke-5 setiap ikat, dan ikat berikutnya bergeser satu lebar ikat", () => {
    const marks = tallyMarks(6);
    expect(marks.map((mark) => mark.slash)).toEqual([false, false, false, false, true, false]);
    expect((marks[5]?.x1 ?? 0) - (marks[0]?.x1 ?? 0)).toBe(TALLY_GROUP_WIDTH);
  });

  it("key tetap saat jumlah bertambah: hanya garis baru yang dipasang (dan digambar)", () => {
    const before = tallyMarks(4).map((mark) => mark.key);
    const after = tallyMarks(6).map((mark) => mark.key);
    expect(after.slice(0, 4)).toEqual(before);
    expect(after.slice(4).filter((key) => before.includes(key))).toEqual([]);
  });
});

describe("tallyDrawOrder", () => {
  it("layar baru: semua garis digambar berurutan dari garis pertama", () => {
    expect([0, 1, 2, 11].map((index) => tallyDrawOrder(null, index))).toEqual([0, 1, 2, 11]);
  });

  it("jumlah bertambah dari 4 ke 6: garis baru mulai dari urutan 0, tanpa menunggu garis lama", () => {
    expect([4, 5].map((index) => tallyDrawOrder(4, index))).toEqual([0, 1]);
  });
});

describe("flapDigits", () => {
  const animated = (previous: string | null, next: string) =>
    flapDigits(previous, next).map((digit) => (digit.delayIndex === null ? "." : String(digit.delayIndex)));

  it("layar baru: semua digit berputar, berurutan dari kiri", () => {
    expect(animated(null, "408213")).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("hanya digit yang berubah yang berputar, dengan jeda berurutan di antara yang berubah saja", () => {
    expect(animated("2340", "2390")).toEqual([".", ".", "0", "."]);
    expect(animated("3210", "3540")).toEqual([".", "0", "1", "."]);
  });

  it("digit yang tidak berubah memakai key yang sama (tidak dipasang ulang); yang berubah key baru", () => {
    const before = flapDigits(null, "2340").map((digit) => digit.key);
    const after = flapDigits("2340", "2390").map((digit) => digit.key);
    expect(after.map((key, i) => key === before[i])).toEqual([true, true, false, true]);
  });

  it("jumlah digit bertambah: dibandingkan dari kanan, satuan tetap sejajar satuan", () => {
    expect(animated("870", "1870")).toEqual(["0", ".", ".", "."]);
  });

  it("nilai sama: tidak ada yang berputar", () => {
    expect(animated("42", "42")).toEqual([".", "."]);
  });
});

describe("leaderboardMoves (FLIP)", () => {
  const entry = (playerId: string, rank: number): LeaderboardEntry => ({
    playerId,
    nickname: playerId,
    teamSize: null,
    score: 1000 - rank,
    delta: 0,
    rank,
  });
  const board = (...ids: string[]) => ids.map((id, index) => entry(id, index + 1));

  it("reveal pertama: tidak ada yang bergeser", () => {
    expect(leaderboardMoves(null, board("a", "b"))).toEqual([
      { playerId: "a", shiftRows: 0, rose: false },
      { playerId: "b", shiftRows: 0, rose: false },
    ]);
  });

  it("naik dua tingkat: digeser dari dua baris di bawah dan diberi bingkai; yang turun tanpa bingkai", () => {
    expect(leaderboardMoves(board("dimas", "nayla", "rara"), board("rara", "dimas", "nayla"))).toEqual([
      { playerId: "rara", shiftRows: 2, rose: true },
      { playerId: "dimas", shiftRows: -1, rose: false },
      { playerId: "nayla", shiftRows: -1, rose: false },
    ]);
  });

  it("pemain dari luar 10 besar masuk dari bawah daftar dan dihitung naik", () => {
    expect(leaderboardMoves(board("a", "b"), board("c", "a"))).toEqual([
      { playerId: "c", shiftRows: 2, rose: true },
      { playerId: "a", shiftRows: -1, rose: false },
    ]);
  });
});

describe("countdownDisplay", () => {
  it("detik dibulatkan ke atas, batang sesuai sisa porsi", () => {
    expect(countdownDisplay(12_400, 20_000)).toEqual({ seconds: 13, fraction: 0.62, urgent: false });
  });

  it(`${COUNTDOWN_URGENT_SEC} detik terakhir berwarna kritis, termasuk saat habis`, () => {
    expect(countdownDisplay(COUNTDOWN_URGENT_SEC * 1000 + 1, 20_000).urgent).toBe(false);
    expect(countdownDisplay(COUNTDOWN_URGENT_SEC * 1000, 20_000).urgent).toBe(true);
    expect(countdownDisplay(0, 20_000)).toEqual({ seconds: 0, fraction: 0, urgent: true });
  });

  it("sisa lebih dari durasi (snapshot setelah resume) tidak membuat batang lebih dari penuh", () => {
    expect(countdownDisplay(25_000, 20_000).fraction).toBe(1);
  });
});

describe("rowOrder", () => {
  it("baris awal berurutan, baris setelah batas memakai jeda yang sama dengan baris terakhir yang dibatasi", () => {
    expect([0, 1, MAX_ROW_ORDER, MAX_ROW_ORDER + 1, 40].map(rowOrder)).toEqual([0, 1, MAX_ROW_ORDER, MAX_ROW_ORDER, MAX_ROW_ORDER]);
  });
});

describe("tenaga sorak", () => {
  it(`${CHEER_ENERGY_MAX} tekan cepat terkirim, tekan berikutnya tidak mengirim apa pun`, () => {
    let energy = fullEnergy(0);
    const sent: boolean[] = [];
    for (let i = 0; i < CHEER_ENERGY_MAX + 1; i++) {
      const spent = spendCheer(energy, 0);
      energy = spent.energy;
      sent.push(spent.sent);
    }
    expect(sent).toEqual([true, true, true, true, true, false]);
  });

  it(`satu garis terisi lagi setiap ${CHEER_ENERGY_REFILL_MS} ms, tidak melebihi ${CHEER_ENERGY_MAX}`, () => {
    const empty = { level: 0, at: 0 };
    expect(energyLevel(empty, CHEER_ENERGY_REFILL_MS)).toBe(1);
    expect(energyLevel(empty, CHEER_ENERGY_REFILL_MS * 2.5)).toBe(2.5);
    expect(energyLevel(empty, 60_000)).toBe(CHEER_ENERGY_MAX);
    expect(spendCheer(empty, CHEER_ENERGY_REFILL_MS).sent).toBe(true);
  });
});
