/**
 * Round BB — the facts a question card shows and guesses from, read from the email itself (pure):
 *   - the B/L numbers it names (subject, attachment names and text, own text), the grade, net weight and ETD the
 *     documents state, the customer ("Asia Deal(Kato)" → KATO), which attachment names a value;
 *   - what a person already turned down for this email (undone / changed) — never suggested again.
 */
import { factsIn } from './email-shipment-facts';
import { SHIPMENT_KEY_RES } from './email-filter.rules';
import type { EmailEvidence } from './email-match.rules';
import { splitQuoted } from './email-quote';

export interface DocFacts {
  bls: string[];
  grade: string | null;
  netMt: number | null;
  /** "2026-11-07". */
  etd: string | null;
  vessel: string | null;
  /** The attachment the grade / net were read from. */
  file: string | null;
}

const GRADE_RE = /\b(?:ALLOY|BILLET|INGOT|GRADE)\b[^\n]{0,24}?\b(1070|6005|6061|6063|P1020|P0507)\b/i;
const BARE_GRADE_RE = /(?<![\d.])(6005|6063|6061|1070)(?![\d.])/;

/** Carrier B/L numbers in a text (198GX… / KMTC… / MEDU… / SITG… / GGVC…), upper-cased, unique. */
export function blsIn(text: string): string[] {
  const out = new Set<string>();
  const t = (text ?? '').normalize('NFKC');
  for (const [re, label] of SHIPMENT_KEY_RES) {
    if (!label.startsWith('B/L')) continue;
    for (const m of t.matchAll(new RegExp(re.source, 'gi'))) out.add(m[0].toUpperCase());
  }
  return [...out];
}

/** What the email's documents (attachments first, then the own text) say about the shipment. */
export function docFacts(ev: EmailEvidence, ciPatterns: string[] = []): DocFacts {
  const { own } = splitQuoted(ev.body ?? '');
  const bls = blsIn([ev.subject, ...ev.attachments.map((a) => `${a.name}\n${a.text ?? ''}`), own].join('\n'));
  let grade: string | null = null;
  let netMt: number | null = null;
  let etd: string | null = null;
  let vessel: string | null = null;
  let file: string | null = null;
  for (const a of ev.attachments) {
    const text = a.text ?? '';
    if (!text) continue;
    const g = GRADE_RE.exec(text)?.[1] ?? null;
    const f = factsIn(text, { attachment: true, ciPatterns }).hits;
    const net = f.find((h) => h.key === 'netWeightMt')?.value ?? null;
    if (!grade && g) {
      grade = g.toUpperCase();
      file = file ?? a.name;
    }
    if (netMt === null && net !== null && Number.isFinite(Number(net))) {
      netMt = Number(net);
      file = file ?? a.name;
    }
    etd = etd ?? f.find((h) => h.key === 'etd')?.value ?? null;
    vessel = vessel ?? f.find((h) => h.key === 'vessel')?.value ?? null;
  }
  const subjectAndOwn = `${ev.subject ?? ''}\n${own}`;
  if (!grade) grade = GRADE_RE.exec(subjectAndOwn)?.[1]?.toUpperCase() ?? BARE_GRADE_RE.exec(ev.subject ?? '')?.[1] ?? null;
  // A table in the own text ("Grade … 6005 203 MM X 5800 MM …") naming ONE grade.
  if (!grade) {
    const inOwn = [...new Set([...own.matchAll(new RegExp(BARE_GRADE_RE.source, 'g'))].map((m) => m[1]))];
    if (inOwn.length === 1) grade = inOwn[0];
  }
  if (netMt === null) {
    const m = /(?<![\d.])(\d{1,4}\.\d{3})\s*(?:MT|M\/T|t\b|T\b|トン)/i.exec(subjectAndOwn);
    if (m) netMt = Number(m[1]);
  }
  if (!etd) {
    const m = /ETD[^0-9\n]{0,25}(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/i.exec(own);
    if (m) etd = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return { bls, grade, netMt, etd, vessel, file };
}

/** The customer the email is for: "Asia Deal(Kato)" / "(Sus)" / "Hoei" in the subject, else a customer counterparty. */
export function customerKeyOf(subject: string | null, counterparty: string | null | undefined, known: string[] = ['SUS', 'KATO', 'HOEI']): string | null {
  const s = (subject ?? '').normalize('NFKC');
  const m = /Asia\s*Deal\s*\(\s*([A-Za-z]+)\s*\)/i.exec(s);
  if (m) {
    const k = m[1].toUpperCase();
    if (k === 'HOUEI') return 'HOEI';
    if (known.includes(k)) return k;
  }
  if (/加藤|kato/i.test(s)) return known.includes('KATO') ? 'KATO' : null;
  if (/豊栄|hou?ei/i.test(s)) return known.includes('HOEI') ? 'HOEI' : null;
  if (/\bSUS\b/i.test(s)) return known.includes('SUS') ? 'SUS' : null;
  const c = String(counterparty ?? '').toUpperCase();
  return known.includes(c) ? c : null;
}

/** The first attachment whose name or text names `value` (null = only the subject / text). */
export function fileNaming(ev: EmailEvidence, value: string): string | null {
  const re = new RegExp(`(?<![A-Z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Z0-9])`, 'i');
  return ev.attachments.find((a) => re.test(a.name) || re.test(a.text ?? ''))?.name ?? null;
}

/**
 * The records a PERSON turned down for this email: `actions.rejected` (round BB), else the targets of an undo that
 * was not the self-check's own (rows from before round BB: Undo in the inbox left `undone` without a RECHECK question).
 */
export function rejectedOf(actions: Record<string, any> | null | undefined): Array<{ orderId: string | null; shipmentId: string | null }> {
  const a = actions ?? {};
  if (Array.isArray(a.rejected)) return a.rejected;
  if (Array.isArray(a.undone) && a.undone.length && a.question?.kind !== 'RECHECK') {
    const out = new Map<string, { orderId: string | null; shipmentId: string | null }>();
    for (const x of a.undone) {
      if (x?.ownerKind === 'shipment' && x.ownerId) out.set(`s:${x.ownerId}`, { orderId: null, shipmentId: x.ownerId });
    }
    return [...out.values()];
  }
  return [];
}

/** Is this record one of the rejected ones (a rejected shipment, or a rejected order with no shipment named)? */
export const isRejected = (rejected: Array<{ orderId: string | null; shipmentId: string | null }>, t: { orderId?: string | null; shipmentId?: string | null }) =>
  rejected.some((r) => (r.shipmentId ? r.shipmentId === (t.shipmentId ?? null) : !!r.orderId && r.orderId === t.orderId && !t.shipmentId));

/** "2026-11-07" → "2026-11"; else the email's own month. */
export const monthOf = (etd: string | null, date: Date | null | undefined) => (etd && /^\d{4}-\d{2}/.test(etd) ? etd.slice(0, 7) : date ? new Date(date).toISOString().slice(0, 7) : null);
