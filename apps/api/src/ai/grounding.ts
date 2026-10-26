import { AI_GROUNDING_MIN_CHARS, normalizeText } from "@sorak/shared";

// Potongan kutipan yang dipisah elipsis minimal sepanjang ini, supaya potongan seperti "DNA" tidak dihitung bukti.
const MIN_FRAGMENT_CHARS = AI_GROUNDING_MIN_CHARS / 2;

/** Tanda baca dan tanda kutip di ujung kutipan: model sering menutup kutipan dengan titik walau materi melanjutkan kalimatnya. */
function trimEdges(text: string): string {
  return text.replace(/^[\s"'.,;:!?()-]+|[\s"'.,;:!?()-]+$/g, "");
}

/**
 * Grounding check: apakah kutipan bukti dari AI benar-benar ada di materi guru. Cara murah untuk menangkap
 * halusinasi (AI mengarang fakta dengan percaya diri). Beda spasi, huruf besar, jenis tanda kutip, dan tanda baca
 * di ujung diabaikan. Kutipan yang dipotong dengan elipsis diterima kalau setiap potongannya ada di materi,
 * berurutan. Kutipan yang terlalu pendek tidak dianggap bukti karena hampir pasti cocok di materi mana pun.
 */
export function isGrounded(evidence: string, sourceText: string): boolean {
  // NFKC di normalizeText mengubah "…" menjadi "...", jadi cukup satu bentuk elipsis.
  const fragments = normalizeText(evidence).split(/\.{3,}/).map(trimEdges);
  if (fragments.join(" ").length < AI_GROUNDING_MIN_CHARS) return false;
  if (fragments.some((fragment) => fragment.length < MIN_FRAGMENT_CHARS)) return false;

  const source = normalizeText(sourceText);
  let from = 0;
  for (const fragment of fragments) {
    const at = source.indexOf(fragment, from);
    if (at === -1) return false;
    from = at + fragment.length;
  }
  return true;
}
