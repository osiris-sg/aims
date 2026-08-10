// Generate the August invoices from the PROD recurring templates (guru
// 2026-08-11) — AIMS ONLY, no Xero calls.
//
//  • Only templates due now (nextRunDate <= today), skipping the annotated
//    [TO DELETE] / [CN PENDING] ones and anything that already ran.
//  • Skips rentals the accountant already invoiced for August: matched against
//    AIMS' BI202608* invoices (fresh — last Xero→AIMS sync 2026-08-11 02:11
//    SGT) by customer + net amount (±0.02) + equipment-serial overlap.
//    Matched templates advance to September and record the number in the name.
//  • Generated invoices are DRAFTS (unconfirmed): no GL, no email, no Xero.
//    Bookkeeping mirrors runOnce(): lastRunAt/lastRunDocumentId set,
//    nextRunDate +1 month, nextRunNo +1.
// Dry-run by default; --apply to write.
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production'), override: true });
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

const R2 = (n: number) => Math.round(n * 100) / 100;
const norm = (x: string) => (x || '').toLowerCase().replace(/pte|ltd|private|limited|\(s\)|\./g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const ordinal = (n: number) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; };

// ---- resolveText/resolveConfig replica (recurring-invoices.service.ts) ----
function resolveText(str: string, date: Date, runNo?: number): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const nextM = (m + 1) % 12, nextY = m === 11 ? y + 1 : y;
  const prevM = (m + 11) % 12, prevY = m === 0 ? y - 1 : y;
  const map: Record<string, string> = {
    MONTH: MONTHS[m], 'MONTH SHORT': MONTHS[m].slice(0, 3), 'MONTH YEAR': `${MONTHS[m]} ${y}`,
    PERIOD: `${MONTHS[m].slice(0, 3)} ${y}`, YEAR: String(y), DAY: pad2(date.getDate()),
    DATE: `${pad2(date.getDate())}/${pad2(m + 1)}/${y}`,
    'NEXT MONTH': MONTHS[nextM], 'NEXT MONTH YEAR': `${MONTHS[nextM]} ${nextY}`,
    'PREV MONTH': MONTHS[prevM], 'PREV MONTH YEAR': `${MONTHS[prevM]} ${prevY}`,
    'MONTH NO': pad2(m + 1), 'PREV MONTH NO': pad2(prevM + 1),
    'MONTH START': `01/${pad2(m + 1)}/${y}`,
    'MONTH END': `${pad2(new Date(y, m + 1, 0).getDate())}/${pad2(m + 1)}/${y}`,
    'PREV MONTH START': `01/${pad2(prevM + 1)}/${prevY}`,
    'PREV MONTH END': `${pad2(new Date(prevY, prevM + 1, 0).getDate())}/${pad2(prevM + 1)}/${prevY}`,
    ...(runNo != null ? { NTH: ordinal(runNo), 'RUN NO': String(runNo) } : {}),
  };
  return str.replace(/\{([A-Z ]+)\}/g, (whole, tok: string) => (tok in map ? map[tok] : whole));
}
function resolveConfig(config: any, date: Date, runNo?: number): any {
  if (config == null) return config;
  if (typeof config === 'string') return resolveText(config, date, runNo);
  if (Array.isArray(config)) return config.map((v) => resolveConfig(v, date, runNo));
  if (typeof config === 'object') { const out: any = {}; for (const [k, v] of Object.entries(config)) out[k] = resolveConfig(v, date, runNo); return out; }
  return config;
}

// ---- number minting replica (document-numbering.service.ts) ----
function fmtPattern(pattern: string, serial: number, date: Date): string {
  const YYYY = String(date.getFullYear()); const YY = YYYY.slice(2);
  const MM = pad2(date.getMonth() + 1); const DD = pad2(date.getDate());
  return (pattern || '').replace(/\{([^}]+)\}/g, (_m, tok: string) => {
    if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, '0');
    if (tok === 'DOC') return 'INV';
    return tok.replace(/YYYY/g, YYYY).replace(/YY/g, YY).replace(/MM/g, MM).replace(/DD/g, DD);
  });
}
async function mintNumber(formatId: string, when: Date): Promise<string> {
  const format = await p.documentNumberFormat.findUniqueOrThrow({ where: { id: formatId } });
  const serialToken = /\{(#+)\}/.exec(format.pattern)!;
  const prefix = fmtPattern(format.pattern.slice(0, serialToken.index), 0, when);
  const suffix = fmtPattern(format.pattern.slice(serialToken.index + serialToken[0].length), 0, when);
  const existing = await p.document.findMany({ where: { organizationId: ORG, name: { startsWith: prefix } }, select: { name: true } });
  let maxExisting = 0;
  for (const d of existing) {
    const name = d.name || '';
    if (suffix && !name.endsWith(suffix)) continue;
    const mid = name.slice(prefix.length, suffix ? name.length - suffix.length : undefined);
    if (/^\d+$/.test(mid)) maxExisting = Math.max(maxExisting, parseInt(mid, 10));
  }
  const claimed = await p.$transaction(async (tx) => {
    const f = await tx.documentNumberFormat.findUniqueOrThrow({ where: { id: format.id } });
    const serial = Math.max(f.nextSerial, maxExisting + 1);
    await tx.documentNumberFormat.update({ where: { id: f.id }, data: { nextSerial: serial + 1 } });
    return serial;
  });
  return fmtPattern(format.pattern, claimed, when);
}

type AugInv = { number: string; contact: string; subTotal: number; total: number; text: string; claimedBy?: string };

// Serial-ish tokens (MG20250058, G06068, 240089, DCA60ESI2, 30001082 …)
const serialTokens = (s: string) => {
  const out = new Set<string>();
  for (const m of s.matchAll(/\b[A-Z]{1,5}-?\d{4,}[A-Z0-9-]*\b/g)) out.add(m[0].replace(/-/g, ''));
  for (const m of s.matchAll(/\b\d{6,}\b/g)) out.add(m[0]);
  return out;
};

async function main() {
  const now = new Date();

  // ---- accountant's August invoices, from AIMS ----
  const custNames = new Map((await p.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const aims = await p.document.findMany({ where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BI202608' } }, select: { name: true, config: true } });
  const augInvs: AugInv[] = aims.map((d) => {
    const c: any = d.config || {};
    return {
      number: d.name!, contact: c.customer?.name || custNames.get(c.customerId) || '',
      subTotal: Number(c.subTotal) || 0, total: Number(c.nettTotal) || 0,
      text: JSON.stringify(c.items || []) + '\n' + (c.reference || ''),
    };
  });
  console.log(`August invoices already in AIMS: ${augInvs.length}\n`);

  // ---- templates: everything unrun participates in matching, so a Sep-start
  //      template's existing August invoice can't be stolen by a due one ----
  const templates = await p.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { name: 'asc' } });
  const eligible = templates.filter((t) => !t.name.includes('[TO DELETE') && !t.name.includes('[CN PENDING') && !t.lastRunDocumentId);
  const isDue = (t: any) => t.nextRunDate <= now;
  console.log(`Templates: ${templates.length} total → ${eligible.filter(isDue).length} due for August, ${eligible.filter((t) => !isDue(t)).length} already Sep-scheduled\n`);

  // ---- match: contact + amount; expected "Nth mth" text is the strong
  //      signal (+10), equipment-serial overlap breaks remaining ties ----
  type Plan = { t: any; net: number; due: boolean; match?: AugInv; score?: number };
  const plans: Plan[] = eligible.map((t) => {
    const cfg: any = t.config || {};
    const net = R2((cfg.items || []).reduce((s: number, it: any) => s + ((Number(it.amount) || Number(it.quantity) * Number(it.unitPrice)) || 0), 0));
    return { t, net, due: isDue(t) };
  });
  const options = (pl: Plan) => augInvs.filter((x) => !x.claimedBy && norm(x.contact) === norm(custNames.get(pl.t.customerId) || '') && (Math.abs(x.subTotal - pl.net) <= 0.02 || Math.abs(x.total - R2(pl.net * 1.09)) <= 0.02));
  // most-constrained first: templates with the fewest possible matches assign first
  plans.sort((a, b) => options(a).length - options(b).length);
  for (const pl of plans) {
    const opts = options(pl);
    if (!opts.length) continue;
    const toks = serialTokens(JSON.stringify(pl.t.config));
    // The August invoice for a due template reads "{nextRunNo}th mth"; a
    // Sep-scheduled one was already billed as "{nextRunNo - 1}th mth".
    const hasNth = /\{NTH\}/.test(JSON.stringify(pl.t.config));
    const expectedNth = hasNth ? `${ordinal(pl.due ? pl.t.nextRunNo : pl.t.nextRunNo - 1)} mth` : null;
    let best: AugInv | undefined; let bestScore = -1;
    for (const o of opts) {
      let score = 0;
      if (expectedNth && o.text.toLowerCase().includes(expectedNth)) score += 10;
      for (const tk of toks) if (o.text.replace(/-/g, '').includes(tk.replace(/-/g, ''))) score++;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (best) { best.claimedBy = pl.t.id; pl.match = best; pl.score = bestScore; }
  }
  plans.sort((a, b) => a.t.name.localeCompare(b.t.name));

  // ---- report + apply ----
  const org = await p.organization.findUnique({ where: { id: ORG }, select: { logo: true, defaultStamp: true, taxRate: true, taxApplicable: true, absorbTax: true, defaultCurrency: true, docTypeDefaults: true } });
  const orgRate = Number(org?.taxRate ?? 9);
  let generated = 0, skippedMatched = 0;
  for (const pl of plans) {
    const t = pl.t;
    const short = t.name.replace(/^Recurring — /, '').slice(0, 46);
    if (!pl.due) {
      // Sep-scheduled (accountant billed August before the import): claiming
      // its invoice here only protects it from the due templates.
      console.log(`OK    ${short} | Sep-scheduled${pl.match ? `, Aug was ${pl.match.number} (score ${pl.score})` : ' (Aug invoice not found in AIMS — check later)'}`);
      continue;
    }
    if (pl.match) {
      skippedMatched++;
      console.log(`SKIP  ${short} | net ${pl.net} → accountant alr invoiced ${pl.match.number} (serial-overlap ${pl.score})`);
      if (APPLY) {
        const nx = new Date(t.nextRunDate); nx.setMonth(nx.getMonth() + 1);
        await p.recurringInvoiceTemplate.update({
          where: { id: t.id },
          data: { name: `${t.name} [Aug invoiced: ${pl.match.number}]`, nextRunDate: nx, nextRunNo: { increment: 1 } },
        });
      }
      continue;
    }
    // ---- generate (generateOne + createBasicDocument replica) ----
    generated++;
    if (!APPLY) { console.log(`GEN   ${short} | net ${pl.net} | nth→${resolveText('{NTH}', now, t.nextRunNo)}`); continue; }

    const cfg: any = resolveConfig(t.config || {}, now, t.nextRunNo ?? 1);
    delete cfg.email;
    cfg.customerId = t.customerId;
    if (!cfg.date) cfg.date = now.toISOString().slice(0, 10);
    if (t.numberFormatId) cfg.numberFormatId = t.numberFormatId;
    const cust = await p.customer.findUnique({ where: { id: t.customerId! }, select: { currency: true } });
    if (cust?.currency) cfg.currency = cust.currency;
    const items: any[] = Array.isArray(cfg.items) ? cfg.items : [];
    for (const it of items) if (it && it.tax == null) it.tax = orgRate;
    const lineAmount = (it: any) => parseFloat(it.amount) || (parseFloat(it.quantity) * parseFloat(it.unitPrice)) || 0;
    const net = items.reduce((s, it) => s + lineAmount(it), 0);
    cfg.subTotal = net;
    cfg.gstAmount = +items.reduce((s, it) => s + lineAmount(it) * ((it.tax || 0) / 100), 0).toFixed(2);
    cfg.nettTotal = +(net + cfg.gstAmount).toFixed(2);
    // org seeding (createBasicDocument)
    if (!cfg.logo && org?.logo) cfg.logo = org.logo;
    if (!cfg.stamp) cfg.stamp = {};
    if (!cfg.stamp.company && org?.defaultStamp) cfg.stamp.company = org.defaultStamp;
    if (!cfg.documentInfo || typeof cfg.documentInfo !== 'object') cfg.documentInfo = {};
    const di = cfg.documentInfo;
    if (di.taxApplicable === undefined && org?.taxApplicable != null) di.taxApplicable = org.taxApplicable ? 'Y' : 'N';
    if (di.absorbTax === undefined && (org as any)?.absorbTax != null) di.absorbTax = (org as any).absorbTax ? 'Y' : 'N';
    if ((di.gstPercent === undefined || di.gstPercent === null || di.gstPercent === 0) && org?.taxRate != null) di.gstPercent = Number(org.taxRate);
    if (!di.currency && org?.defaultCurrency) di.currency = org.defaultCurrency;
    if (!cfg.currency && org?.defaultCurrency) cfg.currency = org.defaultCurrency;
    const typeDefaults: any = ((org?.docTypeDefaults as any) || {})['INVOICE'] || null;
    if (typeDefaults) {
      if (!di.termsAndConditions && typeDefaults.tnc?.trim?.()) di.termsAndConditions = typeDefaults.tnc;
      if (!di.note && typeDefaults.notes?.trim?.()) di.note = typeDefaults.notes;
      if (!di.footerMessage && typeDefaults.footerMessage?.trim?.()) di.footerMessage = typeDefaults.footerMessage;
    }

    const number = await mintNumber(t.numberFormatId!, now);
    const doc = await p.document.create({
      data: { organizationId: ORG, type: 'INVOICE', name: number, documentTemplateId: t.documentTemplateId!, config: cfg, revisionNumber: 0 },
    });
    await p.auditLog.create({
      data: { userId: 'system', userName: 'Recurring invoices', action: 'CREATED', resource: 'document', resourceId: doc.id, resourceName: number, organizationId: ORG, details: { detail: `${number} created` } },
    });
    const nx = new Date(t.nextRunDate); nx.setMonth(nx.getMonth() + 1);
    await p.recurringInvoiceTemplate.update({
      where: { id: t.id },
      data: { lastRunAt: now, lastRunDocumentId: doc.id, nextRunDate: nx, nextRunNo: { increment: 1 } },
    });
    console.log(`GEN   ${short} → ${number} | net ${net} gst ${cfg.gstAmount} gross ${cfg.nettTotal}`);
  }
  console.log(`\n${APPLY ? 'DONE' : 'DRY RUN'}: ${APPLY ? 'generated' : 'would-generate'}=${generated} skip-already-invoiced=${skippedMatched} (of ${eligible.filter(isDue).length} due)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
