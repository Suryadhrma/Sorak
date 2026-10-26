import { AI_GROUNDING_MIN_CHARS, normalizeText } from "@sorak/shared";

/**
 * Grounding check: apakah kutipan bukti dari AI benar-benar ada di materi guru. Cara murah untuk menangkap
 * halusinasi (AI mengarang fakta dengan percaya diri). Beda spasi, huruf besar, dan jenis tanda kutip diabaikan;
 * kutipan yang terlalu pendek tidak dianggap bukti karena hampir pasti cocok di materi mana pun.
 */
export function isGrounded(evidence: string, sourceText: string): boolean {
  const quote = normalizeText(evidence);
  if (quote.length < AI_GROUNDING_MIN_CHARS) return false;
  return normalizeText(sourceText).includes(quote);
}
