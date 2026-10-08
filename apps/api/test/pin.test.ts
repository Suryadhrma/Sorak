import { Pin } from "@sorak/shared";
import { describe, expect, it } from "vitest";
import { UNBIASED_LIMIT, newPin } from "../src/pin.ts";

const sequence = (...values: number[]) => () => {
  const value = values.shift();
  if (value === undefined) throw new Error("sumber acak uji habis");
  return value;
};

describe("newPin", () => {
  it("selalu berbentuk Pin, dari sumber acak sungguhan", () => {
    for (let i = 0; i < 1000; i++) expect(Pin.safeParse(newPin()).success).toBe(true);
  });

  it("mempertahankan nol di depan", () => {
    expect(newPin(sequence(42))).toBe("000042");
  });

  it("batas buang tepat 4.294.000.000", () => {
    expect(UNBIASED_LIMIT).toBe(4_294_000_000);
  });

  it("membuang angka di ujung rentang lalu memakai angka berikutnya", () => {
    expect(newPin(sequence(UNBIASED_LIMIT, 2 ** 32 - 1, UNBIASED_LIMIT - 1))).toBe("999999");
  });
});
