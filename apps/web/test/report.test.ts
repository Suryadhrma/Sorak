import {
  DISTRACTOR_MIN_SHARE,
  REPORT_RETRY_ATTEMPTS,
  REPORT_SAVING_WINDOW_MS,
  REVIEW_BELOW_PERCENT,
  type GameQuestionResult,
} from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { correctPercent, needsReview, reportRetryStep, topDistractor } from "../src/report.ts";

const question = (answerCounts: number[], correctIndex = 1): GameQuestionResult => {
  const answeredCount = answerCounts.reduce((sum, count) => sum + count, 0);
  return {
    position: 0,
    prompt: "Planet terbesar?",
    options: ["Mars", "Jupiter", "Venus", "Bumi"].slice(0, answerCounts.length),
    correctIndex,
    answerCounts,
    answeredCount,
    correctCount: answerCounts[correctIndex] ?? 0,
    avgAnswerMs: null,
  };
};

describe("correctPercent", () => {
  it("benar dibagi yang menjawab, dibulatkan", () => {
    expect(correctPercent(question([1, 2, 0, 0]))).toBe(67);
    expect(correctPercent(question([0, 5, 0, 0]))).toBe(100);
  });

  it("tidak ada yang menjawab -> null (bukan 0%)", () => {
    expect(correctPercent(question([0, 0, 0, 0]))).toBeNull();
  });
});

describe("topDistractor", () => {
  it("pilihan salah terbanyak, dengan jumlah pemilihnya", () => {
    // 20 menjawab: C dipilih 11 siswa.
    expect(topDistractor(question([2, 6, 11, 1]))).toEqual({ index: 2, count: 11 });
  });

  it(`tepat ${DISTRACTOR_MIN_SHARE * 100}% dari yang menjawab masih ditampilkan; di bawahnya tidak`, () => {
    expect(topDistractor(question([2, 8, 0, 0]))).toEqual({ index: 0, count: 2 });
    expect(topDistractor(question([1, 9, 0, 0]))).toBeNull();
  });

  it("pilihan benar tidak pernah jadi pengecoh, walau paling banyak dipilih", () => {
    expect(topDistractor(question([0, 10, 0, 0]))).toBeNull();
  });

  it("seri: huruf yang lebih awal", () => {
    expect(topDistractor(question([3, 4, 3, 0]))).toEqual({ index: 0, count: 3 });
  });

  it("tidak ada yang menjawab -> tidak ada pengecoh", () => {
    expect(topDistractor(question([0, 0, 0, 0]))).toBeNull();
  });
});

describe("needsReview", () => {
  it(`persen benar di bawah ${REVIEW_BELOW_PERCENT}% ditandai, tepat ${REVIEW_BELOW_PERCENT}% tidak`, () => {
    expect(needsReview(question([3, 2, 0, 0]))).toBe(true);
    expect(needsReview(question([2, 2, 0, 0]))).toBe(false);
  });

  it("tidak ada yang menjawab -> tidak ditandai (tidak ada bukti salah paham)", () => {
    expect(needsReview(question([0, 0, 0, 0]))).toBe(false);
  });
});

describe("reportRetryStep (laporan 404)", () => {
  it(`dibuka dari podium dalam ${REPORT_SAVING_WINDOW_MS / 1000} detik -> coba lagi sampai ${REPORT_RETRY_ATTEMPTS} kali`, () => {
    expect(reportRetryStep({ msSinceGameEnded: 1_000, retriesDone: 0 })).toBe("retry");
    expect(reportRetryStep({ msSinceGameEnded: 5_000, retriesDone: REPORT_RETRY_ATTEMPTS - 1 })).toBe("retry");
    expect(reportRetryStep({ msSinceGameEnded: 7_000, retriesDone: REPORT_RETRY_ATTEMPTS })).toBe("give_up");
  });

  it("lewat jendela simpan -> berhenti mencoba, tetap menawarkan Coba lagi", () => {
    expect(reportRetryStep({ msSinceGameEnded: REPORT_SAVING_WINDOW_MS, retriesDone: 0 })).toBe("give_up");
  });

  it("dibuka bukan dari podium (misalnya dari Riwayat atau tautan lama) -> laporan memang tidak ada", () => {
    expect(reportRetryStep({ msSinceGameEnded: null, retriesDone: 0 })).toBe("not_found");
  });
});
