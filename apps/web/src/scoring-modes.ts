import type { ScoringMode } from "@sorak/shared";

/** Nama dan penjelasan singkat mode skor, untuk pilihan mode di "Kuis saya" dan label di layar guru. */
export const SCORING_MODES: Record<ScoringMode, { name: string; hint: string }> = {
  classic: { name: "Klasik", hint: "cepat dan benar" },
  accurate: { name: "Akurat", hint: "benar saja, tanpa tekanan waktu" },
  confidence: { name: "Taruhan Yakin", hint: "pilih seberapa yakin sebelum menjawab" },
};
