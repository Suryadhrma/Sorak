import { nicknameKey } from "@sorak/shared";
import { BLOCKED_ROOTS, BLOCKED_WORDS } from "./blocked-words.ts";

/** Angka dan simbol yang sering dipakai menggantikan huruf (leetspeak). */
const LOOKALIKES: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
};

const SEPARATORS = /[\s._-]+/u;
const blockedWords: ReadonlySet<string> = new Set(BLOCKED_WORDS);

/** Huruf kecil dan spasi rapi (nicknameKey), leetspeak diganti huruf, huruf yang diulang 3x atau lebih dirapatkan. */
function normalize(nickname: string): string {
  const letters = [...nicknameKey(nickname)].map((char) => LOOKALIKES[char] ?? char).join("");
  return letters.replace(/(.)\1{2,}/gu, "$1");
}

/**
 * Nickname boleh dipakai? Kata panjang dicari sebagai potongan teks pada bentuk rapat (tanpa spasi, titik,
 * _ dan -), jadi "a n j i n g" tetap tertangkap. Kata pendek hanya sebagai kata utuh, supaya nama seperti
 * "Masuk" atau "Dicky" tidak ikut tertolak (Scunthorpe problem).
 */
export function isNicknameAllowed(nickname: string): boolean {
  const normalized = normalize(nickname);
  const compact = normalized.replace(new RegExp(SEPARATORS, "gu"), "");
  if (BLOCKED_ROOTS.some((root) => compact.includes(root))) return false;
  return !normalized.split(SEPARATORS).some((word) => blockedWords.has(word));
}
