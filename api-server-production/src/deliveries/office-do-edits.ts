/**
 * enableOfficeDoEdits (Biofuel, 2026-11-23). Default OFF; every other org (WCT
 * included) keeps today's behaviour.
 *
 * Editing a still-scheduled run regenerates its draft DO by shallow-merging a
 * fragment over the DO config. buildScheduledDoConfig only writes the top-level
 * `contactName` / `contactNumber` keys when the new contact HAS them, so the merge
 * kept the old person's values when the Delivery contact changed to someone with
 * no phone, or was cleared. The Biofuel DO editor reads those keys (its
 * field-config maps documentInfo.contactName -> config.contactName), so it showed
 * the previous contact. With the flag on, the regen sets both explicitly (null
 * clears), so the DO's contact always matches the run's Delivery contacts.
 */
export const OFFICE_DO_EDITS_FLAG = 'enableOfficeDoEdits';

export function doContactRefresh(
  attention: { name: string; phoneNumber?: string } | undefined | null,
): { contactName: string | null; contactNumber: string | null } {
  const name = attention?.name?.trim() || null;
  return {
    contactName: name,
    contactNumber: name ? attention?.phoneNumber?.trim() || null : null,
  };
}
