// Several service reports at once (2026-11-03): pure helpers for the field
// app and the office list. Tested by helpers/serviceReportFiles.test.mjs.

/** Most reports one bulk download may carry; the server's MAX_BULK_REPORTS. */
export const MAX_BULK_REPORTS = 50;

const COMPANY_TAIL = /[\s,]+(pte\.?\s*ltd\.?|private\s+limited|sdn\.?\s*bhd\.?|ltd\.?|limited|llp|inc\.?)\s*$/i;

function sgDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * "Service report #145 Capital Cranes Global 2026-11-03" (no extension): the
 * same name the server gives each PDF in the zip
 * (api src/maintenance-reports/service-report-filename.ts), keep them in step.
 */
export function serviceReportFileBase(r: {
  id: string;
  reportNumber: number | null;
  serviceData?: { customerName?: string | null; serviceDate?: string | null } | null;
  signedAt?: string | null;
  createdAt?: string | null;
}): string {
  const sd = r.serviceData ?? {};
  const customer = String(sd.customerName ?? "")
    .replace(COMPANY_TAIL, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  const serviceDate = typeof sd.serviceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sd.serviceDate) ? sd.serviceDate : null;
  const date = serviceDate ?? sgDate(r.signedAt ?? r.createdAt);
  const number = r.reportNumber != null ? `#${r.reportNumber}` : r.id.slice(0, 8);
  return ["Service report", number, customer, date].filter(Boolean).join(" ");
}

/** "Service reports 2026-11-03 (12).zip", as the server names it. */
export function serviceReportsZipName(count: number, now: Date = new Date()): string {
  return `Service reports ${sgDate(now.toISOString())} (${count}).zip`;
}

/** "n reports saved to Downloads", plus the ones that failed, if any. */
export function savedMessage(saved: number, total: number, failed: string[]): string {
  const noun = (n: number) => (n === 1 ? "report" : "reports");
  if (!failed.length) return `${saved} ${noun(saved)} saved to Downloads`;
  if (!saved) return `Could not save ${failed.join(", ")}`;
  return `${saved} of ${total} ${noun(total)} saved to Downloads. Could not save ${failed.join(", ")}`;
}
