import type { ScoringMode } from "@sorak/shared";

/**
 * Nama dan penjelasan mode skor. `hint` untuk label pendek di layar guru, `description` untuk kartu pilihan
 * di dialog Mainkan (board Guru-4).
 */
export const SCORING_MODES: Record<ScoringMode, { name: string; hint: string; description: string }> = {
  classic: {
    name: "Klasik",
    hint: "cepat dan benar",
    description: "Benar dan cepat dapat poin lebih besar. Seru untuk kuis di akhir pelajaran.",
  },
  accurate: {
    name: "Akurat",
    hint: "benar saja, tanpa tekanan waktu",
    description: "Poin hanya dari jawaban benar. Lebih adil kalau sinyal di kelas tidak merata.",
  },
  confidence: {
    name: "Taruhan Yakin",
    hint: "pilih seberapa yakin sebelum menjawab",
    description: "Siswa memilih seberapa yakin sebelum menjawab.",
  },
};
