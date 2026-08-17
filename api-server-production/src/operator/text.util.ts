/**
 * Punctuation normalisation for everything the Operator emits.
 *
 * Em/en dashes are banned in both chat replies and document content. The system
 * prompt asks for that, but prompts are advisory, so this runs at the outbound
 * boundary (adapter sends, and text written into documents) where it is
 * deterministic. A spaced dash reads as a clause break and becomes a comma;
 * hyphens inside words ("Fan-Coil") are left alone.
 */
export const cleanText = (v: any): string =>
  String(v ?? '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,\s*([.!?;:])/g, '$1')
    .trim();
