/**
 * Delivery contacts "Add new contact" (enableOfficeDoEdits, Biofuel 2026-11-23).
 * Name is always required; the inline mode (Schedule a delivery) also requires a
 * phone so the DO's contact line carries a number. Email stays optional.
 */
export function canSaveNewContact(f: { name: string; phone: string; requirePhone?: boolean }): boolean {
  if (!f.name.trim()) return false;
  if (f.requirePhone && !f.phone.trim()) return false;
  return true;
}
