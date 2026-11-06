/**
 * Round BJ — Vedanta's Commercial Invoice (CI) versions. One CI no. (XP…) is issued PROVISIONAL first and FINAL after
 * the LME average is known ("REVISED" in the file name); a shipment's CI amount is the LATEST version's Sub Total
 * (before the advance is deducted). Older versions stay visible as history; a newer version is proposed, never
 * written over a stored amount silently.
 */
import type { Db } from './trade-config.service';

export type CiStatus = 'FINAL' | 'PROVISIONAL';

export interface CiText {
  ciNumber: string | null;
  /** YYYY-MM-DD */
  ciDate: string | null;
  status: CiStatus | null;
  /** Sub Total = net × rate (the CI amount AIMS stores). */
  subTotal: number | null;
  advance: number | null;
  /** TOTAL payable after the advance. */
  total: number | null;
  netMt: number | null;
  lme: number | null;
  premium: number | null;
  rate: number | null;
  /** The supplier (shipper) as the CI prints it: name line + address lines. */
  shipperBlock: string | null;
  countryOfOrigin: string | null;
  hsCode: string | null;
}

const num = (s: string | undefined | null) => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const AMT = '(\\d+(?:,\\d{3})*(?:\\.\\d+)?)';

/** Wrap an address after ", " (~38 characters a line, as ADH's SG→JP shipper box; "JHARSUGUDA,JHARSUGUDA" stays whole). */
export function wrapAddress(s: string, width = 38): string {
  const lines: string[] = [];
  let cur = '';
  for (const p of s.split(/(?<=, )/)) {
    if (cur && (cur + p).trimEnd().length > width) {
      lines.push(cur.trimEnd());
      cur = p;
    } else cur += p;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.join('\n');
}

/** The shipper block: "VEDANTA ALUMINIUM METAL LIMITED – SEZ UNIT,, BURKHAMUNDA, …" → "… LIMITED (SEZ UNIT)\nBURKHAMUNDA, …". */
function shipperOf(lines: string[]): string | null {
  const start = lines.findIndex((l) => /COMMERCIAL INVOICE/i.test(l));
  if (start < 0) return null;
  const body: string[] = [];
  for (const l of lines.slice(start + 1, start + 8)) {
    const line = l.trim();
    if (/^(Producer|Applicant|Regd|GSTIN|Consignee)\b/i.test(line)) break;
    // Labels share lines with the address in some layouts: "Works : VILLAGE BHURKHAMUNDA, …", "…, INDIA IEC Code: 1788…",
    // "ODISHA-768202, INDIAWorks :". Keep the address part, stop after a label line.
    const label = /(Works\s*:|IEC Code)/i.exec(line);
    if (label) {
      const before = line.slice(0, label.index).trim();
      const after = /^Works\s*:\s*(.*?)\s*(?:IEC Code.*)?$/i.exec(line)?.[1] ?? '';
      const part = before || (/[A-Z]{3}/.test(after) && !/^[A-Z0-9]{10,}/.test(after) ? after : '');
      if (part) body.push(part);
      if (before || !part) break;
      continue;
    }
    body.push(line);
  }
  if (!body.length) return null;
  // Name: the line with "SEZ UNIT" (the unit's own name), else the first line.
  const sez = body.findIndex((l) => /SEZ\s*UNIT/i.test(l));
  let name = body[0];
  let rest = body.slice(1);
  if (sez >= 0) {
    const m = /^(.*?LIMITED)\s*(?:[–-]\s*|\()?\s*SEZ\s*UNIT\)?[,\s]*(.*)$/i.exec(body[sez]);
    if (m) {
      name = `${m[1].trim()} (SEZ UNIT)`;
      rest = [m[2], ...body.slice(sez + 1)];
    }
  }
  const address = rest.join(' ').replace(/\s*,\s*,+/g, ',').replace(/\s{2,}/g, ' ').trim();
  return [name, address ? wrapAddress(address) : ''].filter(Boolean).join('\n');
}

/** Read a Vedanta CI from its PDF text layer (exact, free). Fields not found are null. */
export function parseCiText(text: string): CiText {
  const t = text ?? '';
  const lines = t.split(/\r?\n/);
  const status: CiStatus | null = /PROVISIONAL\s+COMMERCIAL\s+INVOICE|PRICE\s+IS\s+PROVISIONAL/i.test(t) ? 'PROVISIONAL' : /FINAL\s+COMMERCIAL\s+INVOICE|PRICE\s+IS\s+FINAL/i.test(t) ? 'FINAL' : null;
  const ciNumber = /(?<![A-Z0-9])(XP\d{10})(?!\d)/.exec(t)?.[1] ?? null;
  const d = /(\d{2})\/(\d{2})\/(\d{4})\s*Invoice Date|Invoice Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(t);
  const ciDate = d ? (d[1] ? `${d[3]}-${d[2]}-${d[1]}` : `${d[6]}-${d[5]}-${d[4]}`) : null;
  // "704,245.90Sub Total" or "Sub Total 128,088.17" — never a date's year ("21/04/2025\nSub Total").
  const pick = (label: string, amt: string) => num(new RegExp(`(?<![\\d/.,])${amt}[ \\t]*${label}|${label}\\s*:?\\s*${amt}`, 'i').exec(t)?.slice(1).find(Boolean));
  const subTotal = pick('Sub\\s*Total', '(\\d+(?:,\\d{3})*\\.\\d{2})');
  const advance = pick('Advance\\s*\\(US\\$\\)', AMT);
  // "PRICE IS FINAL 183.693TOTAL 634,743.90" / "PRICE IS FINAL TOTAL 49.971 128,088.17": the amount is the last number.
  const tot = new RegExp(`PRICE IS (?:FINAL|PROVISIONAL)[^\\n]*?TOTAL\\s*(?:${AMT}\\s+)?${AMT}`, 'i').exec(t);
  const total = tot ? num(tot[2]) : null;
  // Item line: net · LME · premium · rate · amount (the amount equals the Sub Total).
  let netMt: number | null = null;
  let lme: number | null = null;
  let premium: number | null = null;
  let rate: number | null = null;
  for (const m of t.matchAll(new RegExp(`(\\d+\\.\\d{3})\\s+${AMT}\\s+${AMT}\\s+${AMT}\\s+${AMT}`, 'g'))) {
    const v = m.slice(1, 6).map(num);
    if (v.every((x) => x !== null) && subTotal !== null && Math.abs(v[4]! - subTotal) < 0.02) {
      [netMt, lme, premium, rate] = v as number[];
      break;
    }
  }
  if (netMt === null) netMt = num(/(\d+\.\d{3})\s*Qty Net\(MT\)/i.exec(t)?.[1]);
  const origin = /COUNTRY OF ORIGIN\s*:\s*([A-Z][A-Z ]+?)\s*$/im.exec(t)?.[1]?.trim() ?? null;
  const hs = /HS CODE\s*:\s*(\d{4})\.?(\d{2})/i.exec(t);
  return { ciNumber, ciDate, status, subTotal, advance, total, netMt, lme, premium, rate, shipperBlock: shipperOf(lines), countryOfOrigin: origin, hsCode: hs ? `${hs[1]}.${hs[2]}` : null };
}

/** The CI amount AIMS stores: the Sub Total (before the advance), else the printed total. */
export const ciAmountOf = (c: Pick<CiText, 'subTotal' | 'total'>) => c.subTotal ?? c.total ?? null;

export interface CiVersion {
  fileId: string;
  fileName: string;
  uploadedAt: string;
  ciNumber: string | null;
  ciDate: string | null;
  status: CiStatus | null;
  amount: number | null;
  lme?: number | null;
  premium?: number | null;
}

/** "REVISED" / "Reviced" / "REVISE" in a file name marks a re-issued CI. */
const revised = (fileName: string) => /REVI[SC]/i.test(fileName);

/** Order: FINAL after PROVISIONAL; then the later CI date; then a "REVISED" file; then the later upload. */
export function ciRank(a: CiVersion, b: CiVersion): number {
  const st = (v: CiVersion) => (v.status === 'FINAL' ? 2 : v.status === 'PROVISIONAL' ? 1 : 0);
  return st(a) - st(b) || (a.ciDate ?? '').localeCompare(b.ciDate ?? '') || Number(revised(a.fileName)) - Number(revised(b.fileName)) || a.uploadedAt.localeCompare(b.uploadedAt);
}

/** Versions oldest → latest (only those with an amount). */
export const ciHistory = (versions: CiVersion[]) => versions.filter((v) => v.amount !== null).sort(ciRank);

/** The latest CI version, or null. */
export const latestCi = (versions: CiVersion[]) => ciHistory(versions).at(-1) ?? null;

export interface CiProposal {
  from: number | null;
  to: number;
  fileId: string;
  fileName: string;
  ciNumber: string | null;
  ciDate: string | null;
  status: CiStatus | null;
}

/** The latest version's amount when it isn't what the shipment stores (a blank stored amount is a plain fill). */
export function ciProposal(stored: number | null, versions: CiVersion[]): CiProposal | null {
  const l = latestCi(versions);
  if (!l || l.amount === null) return null;
  if (stored !== null && Math.abs(stored - l.amount) < 0.005) return null;
  return { from: stored, to: l.amount, fileId: l.fileId, fileName: l.fileName, ciNumber: l.ciNumber, ciDate: l.ciDate, status: l.status };
}

/** A stored CI read (TradeExtraction.result.raw) → its version facts. Older AI reads have no subTotal: their total is used. */
export function ciVersionOf(raw: Record<string, unknown> | null | undefined, file: { id: string; fileName: string; createdAt: Date | string }): CiVersion {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const status = raw?.status === 'FINAL' || raw?.status === 'PROVISIONAL' ? (raw.status as CiStatus) : /PROVISIONAL/i.test(file.fileName) ? 'PROVISIONAL' : null;
  return {
    fileId: file.id,
    fileName: file.fileName,
    uploadedAt: typeof file.createdAt === 'string' ? file.createdAt : file.createdAt.toISOString(),
    ciNumber: typeof raw?.ciNumber === 'string' ? raw.ciNumber : null,
    ciDate: typeof raw?.ciDate === 'string' ? raw.ciDate : null,
    status,
    amount: n(raw?.subTotal) ?? n(raw?.totalAmount),
    lme: n(raw?.lme),
    premium: n(raw?.premium),
  };
}

/** Every read CI version of the shipment's (visible) CI files — the newest read per file. */
export async function ciVersionsFor(db: Db, organizationId: string, shipmentId: string): Promise<CiVersion[]> {
  const rows = await db.tradeExtraction.findMany({
    where: { organizationId, kind: 'CI', status: 'DONE', file: { links: { some: { shipmentId, hiddenAt: null } } } },
    orderBy: { createdAt: 'desc' },
    select: { fileId: true, result: true, file: { select: { id: true, fileName: true, createdAt: true } } },
  });
  const seen = new Set<string>();
  const out: CiVersion[] = [];
  for (const r of rows) {
    if (seen.has(r.fileId)) continue;
    seen.add(r.fileId);
    out.push(ciVersionOf((r.result as { raw?: Record<string, unknown> } | null)?.raw ?? null, r.file));
  }
  return ciHistory(out);
}
