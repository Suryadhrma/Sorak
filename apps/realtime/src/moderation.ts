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
/**
 * Token sependek ini dianggap pecahan satu kata yang sengaja dipisah ("a n j i n g", "anj.ing"), jadi deretannya
 * digabung. Token yang lebih panjang adalah kata sungguhan dan tidak pernah disambung ke kata lain, supaya
 * "Tania Sialana" tidak terbaca "taniasialana".
 */
const SHORT_TOKEN_MAX = 3;
const blockedWords: ReadonlySet<string> = new Set(BLOCKED_WORDS);

/** Huruf kecil dan spasi rapi (nicknameKey), leetspeak diganti huruf, huruf yang diulang 3x atau lebih dirapatkan. */
function normalize(nickname: string): string {
  const letters = [...nicknameKey(nickname)].map((char) => LOOKALIKES[char] ?? char).join("");
  return letters.replace(/(.)\1{2,}/gu, "$1");
}

/** Gabungan setiap deretan token pendek yang berurutan: ["a","n","j","budi","i"] -> ["anj", "i"]. */
function shortTokenRuns(tokens: readonly string[]): string[] {
  const runs: string[] = [];
  let run = "";
  for (const token of tokens) {
    if ([...token].length <= SHORT_TOKEN_MAX) {
      run += token;
      continue;
    }
    if (run) runs.push(run);
    run = "";
  }
  if (run) runs.push(run);
  return runs;
}

/**
 * Nickname boleh dipakai? Kata panjang (BLOCKED_ROOTS) dicari sebagai potongan teks di setiap kata, dan di
 * gabungan deretan token pendek. Kata pendek (BLOCKED_WORDS) hanya sebagai kata utuh, supaya nama seperti
 * "Masuk" atau "Dicky" tidak ikut tertolak (Scunthorpe problem).
 */
export function isNicknameAllowed(nickname: string): boolean {
  const tokens = normalize(nickname).split(SEPARATORS).filter((token) => token !== "");
  const candidates = [...tokens, ...shortTokenRuns(tokens)];
  if (BLOCKED_ROOTS.some((root) => candidates.some((candidate) => candidate.includes(root)))) return false;
  return !tokens.some((token) => blockedWords.has(token));
}
