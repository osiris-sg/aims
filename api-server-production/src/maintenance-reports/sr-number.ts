/**
 * WCT group service report numbers (UAT 2026-11-25): one format for a report filled in the app and an uploaded one,
 * SR<yyyymm>-<4 digits> (SR202611-0001), per org, a new run each month like the group's QO / DO / INV numbers.
 *
 * Gate: the org's enableWctDocNav flag (WCT (S), Racking, BC Air). Every other org keeps its plain running number.
 * Stored as serviceData.srNumber next to the integer reportNumber, which stays the per-org running number (unique
 * index, list search, sorting). Existing reports keep their numbers (no backfill): only reports numbered from now on
 * get an SR number. A reopened report keeps the one it has.
 *
 * Issued under a per-org advisory lock inside the transaction that writes the report, from the highest SR number of
 * that month among ALL the org's reports (soft-deleted ones included: their row stays, so a deleted report's number
 * is never handed out again; the app hard-deletes only unnumbered drafts).
 */
export const SR_NUMBER_FLAG = 'enableWctDocNav';

/** "SR202611-" for an org day "2026-11-25". */
export function srPrefix(orgDay: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(orgDay || ''));
  if (!m) throw new Error(`Bad org day for a service report number: ${orgDay}`);
  return `SR${m[1]}${m[2]}-`;
}

/** SR202611-0001: the prefix and a serial padded to 4 (a 5th digit appears only past 9999). */
export function formatSrNumber(orgDay: string, serial: number): string {
  return `${srPrefix(orgDay)}${String(serial).padStart(4, '0')}`;
}

/** The next serial after the SR numbers already used with this prefix (anything else is ignored). */
export function nextSrSerial(existing: Array<string | null | undefined>, prefix: string): number {
  let max = 0;
  for (const n of existing) {
    if (typeof n !== 'string' || !n.startsWith(prefix)) continue;
    const tail = n.slice(prefix.length);
    if (/^\d+$/.test(tail)) max = Math.max(max, parseInt(tail, 10));
  }
  return max + 1;
}

/** The report's SR number, when it has one. */
export function srNumberOf(serviceData: unknown): string | null {
  const v = (serviceData as any)?.srNumber;
  return typeof v === 'string' && /^SR\d{6}-\d{4,}$/.test(v) ? v : null;
}

/**
 * The number as people read it: SR202611-0001 when the report has one, else "#5" (the old running number), else
 * null (a draft with no number yet).
 */
export function reportNoLabel(r: { reportNumber?: number | null; serviceData?: unknown }): string | null {
  return srNumberOf(r.serviceData) ?? (r.reportNumber != null ? `#${r.reportNumber}` : null);
}

/** "Service report SR202611-0001" / "Service report #5" / the fallback for a draft. */
export function reportTitle(r: { reportNumber?: number | null; serviceData?: unknown }, draft = 'Service report (draft)'): string {
  const no = reportNoLabel(r);
  return no ? `Service report ${no}` : draft;
}

type SrDb = {
  $executeRawUnsafe: (q: string, ...args: any[]) => Promise<unknown>;
  maintenanceServiceReport: { findMany: (args: any) => Promise<Array<{ serviceData: unknown }>> };
};

/** Claim the next SR number of `orgDay`'s month. Call inside a transaction: the advisory lock holds until it ends. */
export async function claimSrNumber(tx: SrDb, organizationId: string, orgDay: string): Promise<string> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `sr-number:${organizationId}`);
  const prefix = srPrefix(orgDay);
  const rows = await tx.maintenanceServiceReport.findMany({
    where: { organizationId, serviceData: { path: ['srNumber'], string_starts_with: prefix } },
    select: { serviceData: true },
  });
  return formatSrNumber(orgDay, nextSrSerial(rows.map((r) => srNumberOf(r.serviceData)), prefix));
}
