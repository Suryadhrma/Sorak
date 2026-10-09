/**
 * Daftar kata untuk moderasi nickname (moderation.ts). Dua daftar karena dua cara cocok yang berbeda.
 * Kalau ada nama wajar yang tertolak, pindahkan kata penyebabnya dari BLOCKED_ROOTS ke BLOCKED_WORDS;
 * jangan menambah pengecualian untuk satu nama.
 */

/** Kata panjang yang tidak mungkin muncul di nama wajar: dicocokkan sebagai potongan teks pada bentuk rapat. */
export const BLOCKED_ROOTS = [
  "anjing",
  "bangsat",
  "bajingan",
  "kontol",
  "memek",
  "ngentot",
  "jancok",
  "jancuk",
  "bego",
  "goblok",
  "tolol",
  "keparat",
  "kampret",
  "pelacur",
  "lonte",
  "perek",
  "setan",
  "sialan",
  "fuck",
  "bitch",
  "pussy",
] as const;

/**
 * Kata pendek yang bisa muncul di dalam nama wajar ("asu" di Masuk, "tai" di Sutaini, "dick" di Dicky,
 * "shit" di Ashita): hanya dicocokkan sebagai kata utuh.
 */
export const BLOCKED_WORDS = [
  "asu",
  "tai",
  "babi",
  "monyet",
  "kunyuk",
  "jembut",
  "peler",
  "coli",
  "sex",
  "porn",
  "shit",
  "dick",
] as const;
