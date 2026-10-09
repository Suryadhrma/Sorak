import { describe, expect, it } from "vitest";
import { BLOCKED_ROOTS, BLOCKED_WORDS } from "../src/blocked-words.ts";
import { isNicknameAllowed } from "../src/moderation.ts";

const LEET: Record<string, string> = { a: "4", i: "1", e: "3", o: "0", s: "5", t: "7", b: "8" };
const leet = (word: string) => [...word].map((char) => LEET[char] ?? char).join("");
const repeated = (word: string) => word.replace(/(.)/, "$1$1$1");

describe("isNicknameAllowed: kata panjang (potongan teks)", () => {
  it.each(BLOCKED_ROOTS)("%s ditolak, juga huruf besar, leetspeak, berspasi, bertitik, dan huruf berulang", (root) => {
    for (const variant of [root, root.toUpperCase(), leet(root), [...root].join(" "), [...root].join("."), repeated(root), `Si ${root}`]) {
      expect(isNicknameAllowed(variant), variant).toBe(false);
    }
  });
});

describe("isNicknameAllowed: kata pendek (kata utuh)", () => {
  it.each(BLOCKED_WORDS)("%s ditolak sebagai kata utuh, juga huruf besar, leetspeak, dan huruf berulang", (word) => {
    for (const variant of [word, word.toUpperCase(), leet(word), repeated(word), `Rina ${word}`, `${word}_01`]) {
      expect(isNicknameAllowed(variant), variant).toBe(false);
    }
  });

  it.each(["asu", "Si Tai", "babi_01", "4nj1ng", "a n j i n g", "anj.ing", "anjjjing", "dasarsialan", "s i a l a n"])("%s ditolak", (nickname) => {
    expect(isNicknameAllowed(nickname)).toBe(false);
  });
});

describe("isNicknameAllowed: nama wajar (Scunthorpe problem)", () => {
  it.each([
    "Masuk",
    "Pasukan",
    "Sutaini",
    "Tasya",
    "Bastian",
    "Anjani",
    "Dimas",
    "Setiawan",
    "Dicky",
    "Ashita",
    "Kampung Baru",
    "Begonia",
    "Perekat",
    "Prasiala Nana",
    "Rina 2",
    "Budi_07",
  ])("%s diterima", (nickname) => {
    expect(isNicknameAllowed(nickname)).toBe(true);
  });
});
