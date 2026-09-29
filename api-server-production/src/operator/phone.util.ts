/**
 * A phone number as E.164 digits (no "+"): "+65 8053 7238", "6580537238" and a
 * Singapore local "8053 7238" all become "6580537238". Identity on the wa-web
 * channel is an EXACT match on this form: no suffix or containment matching,
 * which would let one number stand in for another.
 */
export function toE164Digits(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let d = s.replace(/\D/g, '');
  if (s.startsWith('00')) d = d.slice(2);
  // A bare 8-digit Singapore number (mobiles 8/9, landlines 6, 3 for VoIP).
  if (d.length === 8 && /^[3689]/.test(d)) d = `65${d}`;
  // E.164 allows at most 15 digits; anything under 8 is not a phone number.
  return d.length >= 8 && d.length <= 15 ? d : null;
}
