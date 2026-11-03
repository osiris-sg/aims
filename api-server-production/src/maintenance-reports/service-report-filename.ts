import { orgToday } from '../common/org-today';

/**
 * "Service report #145 Capital Cranes Global 2026-11-03.pdf": the number, the
 * customer (without the "Pte Ltd" tail) and the service date, so a folder of
 * them is easy to search. The field app builds the same name for the files it
 * saves on the phone (portal app/(field)/lib/serviceReportFileName.ts), keep
 * the two in step.
 */
const COMPANY_TAIL = /[\s,]+(pte\.?\s*ltd\.?|private\s+limited|sdn\.?\s*bhd\.?|ltd\.?|limited|llp|inc\.?)\s*$/i;

export function serviceReportFileName(r: {
  id: string;
  reportNumber: number | null;
  serviceData?: unknown;
  signedAt?: Date | null;
  createdAt?: Date | null;
}, timeZone?: string | null): string {
  const sd = (r.serviceData as Record<string, any> | null) ?? {};
  const customer = String(sd.customerName ?? '')
    .replace(COMPANY_TAIL, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  const serviceDate = typeof sd.serviceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sd.serviceDate) ? sd.serviceDate : null;
  const when = r.signedAt ?? r.createdAt ?? null;
  const date = serviceDate ?? (when ? orgToday(timeZone, when) : null);
  const number = r.reportNumber != null ? `#${r.reportNumber}` : r.id.slice(0, 8);
  return ['Service report', number, customer, date].filter(Boolean).join(' ') + '.pdf';
}

/** "name.pdf", "name (2).pdf", … so two files in one zip never collide. */
export function uniqueFileName(name: string, taken: Set<string>): string {
  let out = name;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = name.replace(/\.pdf$/i, ` (${n}).pdf`);
  taken.add(out.toLowerCase());
  return out;
}
