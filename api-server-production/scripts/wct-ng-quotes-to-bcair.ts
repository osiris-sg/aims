/**
 * Part D (2026-11-12): move WCT (S) Systems' "(NG)" quotations to BC Air, then
 * link each moved quotation to its BC Air invoice. DRY RUN BY DEFAULT.
 *
 * What it does (on --apply, ONE transaction, all or nothing):
 *   1. Picks every WCT QUOTATION whose config.subject or config.referenceNo
 *      contains "(NG)" (the old ERP's marker for BC Air work).
 *   2. HOLDS the ones tied to a real-amount (NG) WCT invoice (same subject and
 *      customer, total > $1). Those stay in WCT; they are listed for the owner.
 *   3. Maps each quote's customer to a BC Air customer: normalised NAME first.
 *      A match by customer CODE only, or several BC Air customers with the
 *      same name, is never automatic: --decisions=<json> settles it
 *      ({ "<wctCustomerId>": { "action": "map", "bcCustomerId": "..." } |
 *        { "action": "create" } }). Customers with no match are created in
 *      BC Air from the WCT row; a code already used in BC Air is re-issued by
 *      the app's own rule (C + first letter + highest number + 1), computed
 *      from existing codes. No numbering counter is touched.
 *   4. Moves the quotes: organization, BC Air's QUOTATION template, the BC Air
 *      customer, the issuing-company block and UEN; the old Q-number and every
 *      amount stay; config.movedFrom records where it came from. Search
 *      embeddings follow the document. Activity / audit logs stay as history.
 *   5. Links each moved quote to its BC Air invoice(s), invoice side only
 *      (config.sourceDocumentId / Type / Number, only where empty):
 *        a. the quote number appears in the invoice's reference or subject,
 *           and the invoice's customer is the quote's (mapped) customer;
 *        b1. bridge: the quote's own (NG) placeholder invoice in WCT (same
 *           subject + customer) is the BC Air invoice's Reference, same customer;
 *        b2. same customer + same subject (ignoring "(NG)") + same total,
 *           unique on both sides.
 *      Anything ambiguous is left unlinked and listed. No amount, status or
 *      journal changes.
 *   6. GL check: journal counts of both orgs are equal before and after (the
 *      script writes no journal), and no journal points at a moved quote.
 *
 * Dry run (read-only session):
 *   DBURL=<prod> npx ts-node --transpile-only scripts/wct-ng-quotes-to-bcair.ts [--decisions=<json>] [--out=<dir>]
 * Apply (prod needs --confirm-prod; refuses while any decision is open):
 *   DBURL=<prod> npx ts-node --transpile-only scripts/wct-ng-quotes-to-bcair.ts --decisions=<json> --apply --confirm-prod
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const NG = `(config->>'subject' ilike '%(NG)%' or config->>'referenceNo' ilike '%(NG)%')`;

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
// Owner, 2026-11-12: move the held ones too (their real-amount WCT invoices stay in WCT; no GL change).
const INCLUDE_HELD = process.argv.includes('--include-held');
const OUT = arg('out') || path.join(process.cwd(), 'wct-ng-move-out');

type Decision = { action: 'map'; bcCustomerId: string } | { action: 'create' };

/**
 * Broken characters in the imported T&C text: UTF-8 bytes that were read as
 * Windows-1252 (e.g. "Ltd\u00e2\u20ac\u2122s" for "Ltd\u2019s"). Each such run
 * is turned back into its bytes and decoded as UTF-8; a run that does not
 * decode cleanly is left exactly as it is. Nothing else in the text changes.
 * An em-dash comes back as a plain hyphen (house rule: no em-dashes).
 */
const CP1252: Record<string, number> = {
  '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84, '\u2026': 0x85, '\u2020': 0x86, '\u2021': 0x87, '\u02c6': 0x88,
  '\u2030': 0x89, '\u0160': 0x8a, '\u2039': 0x8b, '\u0152': 0x8c, '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92, '\u201c': 0x93,
  '\u201d': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97, '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203a': 0x9b,
  '\u0153': 0x9c, '\u017e': 0x9e, '\u0178': 0x9f,
};
const byteOf = (ch: string): number | null => {
  if (CP1252[ch] !== undefined) return CP1252[ch];
  const c = ch.charCodeAt(0);
  return c >= 0x80 && c <= 0xff ? c : null;
};
const MOJIBAKE_RUN = /[\u00c2-\u00f4][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]+/g;
export function fixMojibake(text: string): { text: string; fixes: number } {
  let fixes = 0;
  const out = text.replace(MOJIBAKE_RUN, (run) => {
    const bytes = [...run].map(byteOf);
    if (bytes.some((b) => b === null)) return run;
    const decoded = Buffer.from(bytes as number[]).toString('utf8');
    if (decoded.includes('\ufffd')) return run;
    fixes++;
    return decoded.replace(/\u2014/g, '-');
  });
  return { text: out, fixes };
}

const normName = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(pteltd|privatelimited|ltd|llp)$/, '');
const normSubject = (s: unknown) =>
  String(s ?? '')
    .replace(/\(NG\)/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const money = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
/** "Q-000356" / "Q000356" / "q-356" all → "Q356". */
const qKey = (s: string) => {
  const m = /^Q-?0*(\d+)$/i.exec(s.trim());
  return m ? `Q${m[1]}` : null;
};
const qTokens = (s: unknown) => [...String(s ?? '').matchAll(/\bQ-?\d{3,7}\b/gi)].map((m) => qKey(m[0])).filter((x): x is string => !!x);

const csv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
};

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  const isProd = !!prodHost && new URL(url).host === prodHost;
  if (APPLY && isProd && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const decisions: Record<string, Decision> = arg('decisions') ? JSON.parse(fs.readFileSync(arg('decisions')!, 'utf8')) : {};

  const c = new Client({ connectionString: url });
  await c.connect();
  if (!APPLY) await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const q = async <T = any>(sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[];

  try {
    if (APPLY) await c.query('BEGIN');

    // ------------------------------------------------------------ 1. the quotes
    const quotes = await q(
      `select id, name, status, "listIssueDate", "documentTemplateId", "listCustomerId", config
       from "Document" where "organizationId" = $1 and type = 'QUOTATION' and ${NG} order by name`,
      [WCT],
    );

    // ------------------------------------------------------------ 2. holds
    const ngInvoices = await q(
      `select id, name, status, config->>'subject' subject, config->>'customerId' "customerId", config->>'totalWithTax' total
       from "Document" where "organizationId" = $1 and type = 'INVOICE' and ${NG}`,
      [WCT],
    );
    const invByKey = new Map<string, any[]>();
    for (const i of ngInvoices) {
      const k = `${i.customerId}|${i.subject}`;
      invByKey.set(k, [...(invByKey.get(k) ?? []), i]);
    }
    const held: any[] = [];
    const moving: any[] = [];
    for (const qt of quotes) {
      const real = (invByKey.get(`${qt.config.customerId}|${qt.config.subject}`) ?? []).filter((i) => (money(i.total) ?? 0) > 1);
      if (real.length) held.push({ qt, real });
      if (!real.length || INCLUDE_HELD) moving.push(qt);
    }

    // ------------------------------------------------------------ 3. customers
    const wctCustIds = [...new Set(moving.map((x) => x.config.customerId).filter(Boolean))];
    const wctCust = await q(`select * from "Customer" where "organizationId" = $1 and id::text = any($2::text[])`, [WCT, wctCustIds]);
    const wctById = new Map(wctCust.map((w: any) => [w.id, w]));
    const bcCust = await q(`select id, name, "customerCode", email from "Customer" where "organizationId" = $1`, [BCAIR]);
    const bcByName = new Map<string, any[]>();
    for (const b of bcCust) bcByName.set(normName(b.name), [...(bcByName.get(normName(b.name)) ?? []), b]);
    const bcByCode = new Map(bcCust.filter((b: any) => b.customerCode).map((b: any) => [b.customerCode, b]));
    const bcById = new Map(bcCust.map((b: any) => [b.id, b]));
    const takenCodes = new Set(bcCust.map((b: any) => b.customerCode).filter(Boolean) as string[]);
    const takenEmails = new Set(bcCust.map((b: any) => (b.email || '').toLowerCase()).filter(Boolean));

    const nextCode = (name: string) => {
      const letter = name?.normalize('NFD').toUpperCase().match(/[A-Z0-9]/)?.[0] || 'X';
      const prefix = `C${letter}`;
      let max = 0;
      for (const code of takenCodes) {
        const m = new RegExp(`^${prefix}(\\d+)$`).exec(code);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      return `${prefix}${String(max + 1).padStart(3, '0')}`;
    };

    const mapping = new Map<string, { bcId: string; bcName: string; bcCode: string | null; how: string }>();
    const codeOnly: any[] = [];
    const ambiguousName: any[] = [];
    const missingWct: string[] = [];
    const toCreate: any[] = [];
    for (const id of wctCustIds) {
      const w = wctById.get(id);
      if (!w) {
        missingWct.push(id);
        continue;
      }
      const byName = bcByName.get(normName(w.name)) ?? [];
      const dec = decisions[id];
      if (dec?.action === 'map') {
        const b = bcById.get(dec.bcCustomerId);
        if (!b) throw new Error(`Decision for ${w.name}: BC Air customer ${dec.bcCustomerId} not found`);
        mapping.set(id, { bcId: b.id, bcName: b.name, bcCode: b.customerCode, how: 'decision' });
        continue;
      }
      if (byName.length === 1 && dec?.action !== 'create') {
        mapping.set(id, { bcId: byName[0].id, bcName: byName[0].name, bcCode: byName[0].customerCode, how: 'name' });
        continue;
      }
      if (byName.length > 1 && dec?.action !== 'create') {
        ambiguousName.push({ wctCustomerId: id, wctName: w.name, wctCode: w.customerCode, candidates: byName.map((b) => `${b.customerCode ?? ''} ${b.name} (${b.id})`).join(' | ') });
        continue;
      }
      const byCode = w.customerCode ? bcByCode.get(w.customerCode) : null;
      if (byCode && !dec) {
        codeOnly.push({ wctCustomerId: id, wctName: w.name, code: w.customerCode, bcCustomerId: byCode.id, bcName: byCode.name });
        continue;
      }
      // Create in BC Air.
      let code: string | null = w.customerCode || null;
      let codeNote = 'kept';
      if (!code || takenCodes.has(code)) {
        codeNote = code ? `re-issued (${code} is taken in BC Air)` : 'issued';
        code = nextCode(w.name);
      }
      takenCodes.add(code);
      let email: string | null = (w.email || '').trim() || null;
      let emailNote = '';
      if (email && takenEmails.has(email.toLowerCase())) {
        emailNote = `email ${email} already on a BC Air customer, left empty`;
        email = null;
      }
      if (email) takenEmails.add(email.toLowerCase());
      const newId = randomUUID();
      toCreate.push({ newId, wctCustomerId: id, name: w.name, wctCode: w.customerCode, code, codeNote, email, emailNote, phone: w.phone, address: w.address, gstRegNo: w.gstRegNo, uen: w.uen, externalRef: w.externalRef, currency: w.currency || 'SGD' });
      mapping.set(id, { bcId: newId, bcName: w.name, bcCode: code, how: 'create' });
    }
    const openDecisions = codeOnly.length + ambiguousName.length + missingWct.length;

    // ------------------------------------------------------------ 4. move plan
    const tmpl = await q(
      `select t.id, t.name, t."templateVariant" from "OrganizationActiveTemplate" a join "DocumentTemplate" t on t.id = a."templateId"
       where a."organizationId" = $1 and a.type = 'QUOTATION' order by a."isPrimary" desc limit 1`,
      [BCAIR],
    );
    const ownTmpl = tmpl.length
      ? tmpl
      : await q(`select id, name, "templateVariant" from "DocumentTemplate" where "organizationId" = $1 and type = 'QUOTATION' order by "isDefault" desc, "isActive" desc, "createdAt" desc limit 1`, [BCAIR]);
    if (!ownTmpl.length) throw new Error('BC Air has no QUOTATION template');
    const bcTemplate = ownTmpl[0];
    const bcOrg = (await q(`select name, address, "phoneNumber", "registrationNumber" from "Organization" where id = $1`, [BCAIR]))[0];
    const bcCompany = { name: bcOrg.name, address: bcOrg.address ?? '', phoneNumber: bcOrg.phoneNumber ?? '' };

    const ready = moving.filter((x) => mapping.has(x.config.customerId));
    const blocked = moving.filter((x) => !mapping.has(x.config.customerId));
    const nameCounts = new Map<string, number>();
    for (const x of ready) nameCounts.set(x.name, (nameCounts.get(x.name) ?? 0) + 1);
    const existingBcNames = new Set((await q(`select name from "Document" where "organizationId" = $1 and "documentTemplateId"::text = $2`, [BCAIR, bcTemplate.id])).map((r: any) => r.name));
    const nameClashes = [...nameCounts].filter(([n, k]) => k > 1 || existingBcNames.has(n)).map(([n]) => n);

    const ids = ready.map((x) => x.id);
    const allIds = quotes.map((x) => x.id);
    const related = {
      actionLog: (await q(`select count(*)::int n from "ActionLog" where "resourceId"::text = any($1::text[])`, [allIds]))[0].n,
      auditLog: (await q(`select count(*)::int n from "AuditLog" where "resourceId"::text = any($1::text[])`, [allIds]))[0].n,
      signLinks: (await q(`select count(*)::int n from "DocumentSignLink" where "documentId"::text = any($1::text[])`, [allIds]))[0].n,
      embeddings: (await q(`select count(*)::int n from "DocumentEmbedding" where "documentId"::text = any($1::text[])`, [allIds]))[0].n,
      notifications: (await q(`select count(*)::int n from "Notification" where "entityId"::text = any($1::text[])`, [allIds]))[0].n,
      revisions: (await q(`select count(*)::int n from "Document" where "baseDocumentId"::text = any($1::text[])`, [allIds]))[0].n,
      orders: (await q(`select count(*)::int n from "Order" where "sourceQuotationId"::text = any($1::text[])`, [allIds]))[0].n,
      deliveries: (await q(`select count(*)::int n from "Delivery" where "sourceQuotationId"::text = any($1::text[])`, [allIds]))[0].n,
      docsSourcedFromQuotes: (await q(`select count(*)::int n from "Document" where config->>'sourceDocumentId' = any($1::text[])`, [allIds]))[0].n,
    };

    // ------------------------------------------------------------ 5. invoice matching
    const bcInv = await q(
      `select id, name, status, config->>'customerId' "customerId", config->>'customerName' "customerName",
         config->>'subject' subject, config->>'totalWithTax' total, coalesce(config->>'sourceDocumentId','') src,
         concat_ws(' ', config->>'referenceNo', config->'documentInfo'->>'referenceNo', config->>'reference', config->>'xeroReference') refs,
         config->>'referenceNo' "referenceNo"
       from "Document" where "organizationId" = $1 and type = 'INVOICE'`,
      [BCAIR],
    );
    const sameCustomer = (inv: any, m: { bcId: string; bcName: string }) => inv.customerId === m.bcId || (!inv.customerId && normName(inv.customerName) === normName(m.bcName));
    const byRefInv = new Map<string, any[]>();
    for (const inv of bcInv) for (const t of [...qTokens(inv.refs), ...qTokens(inv.subject)]) byRefInv.set(t, [...(byRefInv.get(t) ?? []), inv]);
    const byWctInvNo = new Map<string, any[]>();
    for (const inv of bcInv) if (inv.referenceNo) byWctInvNo.set(inv.referenceNo.trim(), [...(byWctInvNo.get(inv.referenceNo.trim()) ?? []), inv]);

    type Link = { quoteId: string; quoteNo: string; invoiceId: string; invoiceNo: string; rule: string };
    const proposals: Link[] = [];
    const notes: any[] = [];
    for (const x of ready) {
      const m = mapping.get(x.config.customerId)!;
      const key = qKey(x.name);
      // a. number
      const a = (key ? byRefInv.get(key) ?? [] : []).filter((i) => sameCustomer(i, m));
      if (a.length) {
        for (const i of a) proposals.push({ quoteId: x.id, quoteNo: x.name, invoiceId: i.id, invoiceNo: i.name, rule: 'a:number' });
        continue;
      }
      const aOther = key ? byRefInv.get(key) ?? [] : [];
      if (aOther.length) notes.push({ quoteNo: x.name, note: `number found on ${aOther.map((i) => i.name).join(', ')} but another customer` });
      // b1. bridge through the WCT placeholder invoice(s)
      const placeholders = invByKey.get(`${x.config.customerId}|${x.config.subject}`) ?? [];
      const b1 = placeholders.flatMap((p) => byWctInvNo.get(p.name) ?? []).filter((i) => sameCustomer(i, m));
      if (b1.length) {
        for (const i of b1) proposals.push({ quoteId: x.id, quoteNo: x.name, invoiceId: i.id, invoiceNo: i.name, rule: 'b1:wct-invoice-ref' });
        continue;
      }
      // b2. customer + subject + total, unique
      const qs = normSubject(x.config.subject), qt = money(x.config.totalWithTax);
      const b2 = bcInv.filter((i) => sameCustomer(i, m) && normSubject(i.subject) === qs && money(i.total) === qt);
      if (b2.length === 1) proposals.push({ quoteId: x.id, quoteNo: x.name, invoiceId: b2[0].id, invoiceNo: b2[0].name, rule: 'b2:customer+subject+total' });
      else if (b2.length > 1) notes.push({ quoteNo: x.name, note: `${b2.length} invoices tie on customer+subject+total` });
    }
    // An invoice claimed by several quotes (a recurring job: same customer and
    // subject every year) keeps only the ONE quote whose total equals the
    // invoice total; otherwise it is ambiguous and nothing is linked.
    const invById = new Map(bcInv.map((i: any) => [i.id, i]));
    const quoteById = new Map(ready.map((x) => [x.id, x]));
    const claims = new Map<string, Set<string>>();
    for (const p of proposals) claims.set(p.invoiceId, new Set([...(claims.get(p.invoiceId) ?? []), p.quoteId]));
    const winner = new Map<string, string | null>();
    for (const [invId, qs] of claims) {
      if (qs.size === 1) winner.set(invId, [...qs][0]);
      else {
        const total = money(invById.get(invId)!.total);
        const same = [...qs].filter((qid) => money(quoteById.get(qid)!.config.totalWithTax) === total);
        winner.set(invId, same.length === 1 ? same[0] : null);
      }
    }
    const links: Link[] = [];
    const conflicts: any[] = [];
    for (const p of proposals) {
      const w = winner.get(p.invoiceId);
      if (w !== p.quoteId) {
        if (w === null) conflicts.push({ ...p, why: 'invoice claimed by several quotes, no single total match' });
        continue;
      }
      if ((claims.get(p.invoiceId)?.size ?? 0) > 1) p.rule += '+total';
      if (invById.get(p.invoiceId)!.src) {
        conflicts.push({ ...p, why: 'invoice already has a source document' });
        continue;
      }
      if (!links.some((l) => l.invoiceId === p.invoiceId)) links.push(p);
    }
    const linkedQuotes = new Set(links.map((l) => l.quoteId));
    const unmatched = ready
      .filter((x) => !linkedQuotes.has(x.id))
      .map((x) => ({
        quoteNo: x.name,
        date: x.listIssueDate ?? '',
        customer: mapping.get(x.config.customerId)?.bcName ?? x.config.customerName,
        total: x.config.totalWithTax,
        subject: x.config.subject,
        note: notes.find((n) => n.quoteNo === x.name)?.note ?? conflicts.find((cf) => cf.quoteNo === x.name)?.why ?? '',
      }));

    // ------------------------------------------------------------ 6. GL + counts
    const counts = async () => ({
      journals: Object.fromEntries((await q(`select "organizationId" o, count(*)::int n from "JournalEntry" where "organizationId" = any($1::text[]) group by 1`, [[WCT, BCAIR]])).map((r: any) => [r.o === WCT ? 'WCT' : 'BCAIR', r.n])),
      quotations: Object.fromEntries((await q(`select "organizationId" o, count(*)::int n from "Document" where type = 'QUOTATION' and "organizationId" = any($1::text[]) group by 1`, [[WCT, BCAIR]])).map((r: any) => [r.o === WCT ? 'WCT' : 'BCAIR', r.n])),
      customers: Object.fromEntries((await q(`select "organizationId" o, count(*)::int n from "Customer" where "organizationId" = any($1::text[]) group by 1`, [[WCT, BCAIR]])).map((r: any) => [r.o === WCT ? 'WCT' : 'BCAIR', r.n])),
      invoicesWithSource: (await q(`select count(*)::int n from "Document" where "organizationId" = $1 and type = 'INVOICE' and coalesce(config->>'sourceDocumentId','') <> ''`, [BCAIR]))[0].n,
    });
    const before = await counts();
    const journalsOnQuotes = (await q(`select count(*)::int n from "JournalEntry" where "sourceDocumentId"::text = any($1::text[])`, [allIds]))[0].n;
    const projected = {
      quotations: { WCT: (before.quotations.WCT ?? 0) - ready.length, BCAIR: (before.quotations.BCAIR ?? 0) + ready.length },
      customers: { WCT: before.customers.WCT, BCAIR: (before.customers.BCAIR ?? 0) + toCreate.length },
      journals: before.journals,
      invoicesWithSource: before.invoicesWithSource + links.length,
    };

    const summary = {
      mode: APPLY ? 'APPLY' : 'DRY RUN',
      target: isProd ? 'PROD' : 'non-prod',
      quotes: quotes.length,
      held: held.length,
      heldMovedToo: INCLUDE_HELD,
      toMove: ready.length,
      tncBrokenCharacters: (() => {
        let quotesFixed = 0, runs = 0;
        const samples: string[] = [];
        for (const x of ready) {
          const t = x.config.termsAndConditions;
          if (typeof t !== 'string') continue;
          const r = fixMojibake(t);
          if (!r.fixes) continue;
          quotesFixed++;
          runs += r.fixes;
          if (samples.length < 3) {
            const i = t.search(MOJIBAKE_RUN);
            samples.push(`${JSON.stringify(t.slice(Math.max(0, i - 12), i + 14))} -> ${JSON.stringify(fixMojibake(t.slice(Math.max(0, i - 12), i + 14)).text)}`);
          }
        }
        const leftover = ready.filter((x) => typeof x.config.termsAndConditions === 'string' && /\u00e2\u20ac|\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]/.test(fixMojibake(x.config.termsAndConditions).text)).length;
        return { quotesFixed, runs, samples, quotesStillWithBrokenCharacters: leftover };
      })(),
      blockedByOpenCustomerDecision: blocked.length,
      customers: {
        used: wctCustIds.length,
        mappedByName: [...mapping.values()].filter((m) => m.how === 'name').length,
        mappedByDecision: [...mapping.values()].filter((m) => m.how === 'decision').length,
        toCreate: toCreate.length,
        codeOnly: codeOnly.length,
        ambiguousName: ambiguousName.length,
        missingWctRow: missingWct.length,
        newCodesReissued: toCreate.filter((t) => t.codeNote.startsWith('re-issued')).length,
        newEmailsDropped: toCreate.filter((t) => t.emailNote).length,
      },
      bcTemplate: `${bcTemplate.name} (${bcTemplate.templateVariant}, ${bcTemplate.id})`,
      nameClashesOnBcTemplate: nameClashes.length,
      related,
      invoiceLinks: {
        bcAirInvoices: bcInv.length,
        quotesLinked: linkedQuotes.size,
        invoicesLinked: links.length,
        byRule: links.reduce((acc: Record<string, number>, l) => ((acc[l.rule] = (acc[l.rule] ?? 0) + 1), acc), {}),
        quotesUnmatched: unmatched.length,
        conflictsSkipped: conflicts.length,
      },
      gl: { before: before.journals, journalsReferencingMovedQuotes: journalsOnQuotes },
      before,
      projected,
    };

    // ------------------------------------------------------------ apply
    if (APPLY) {
      if (openDecisions || blocked.length) throw new Error(`Refusing: ${openDecisions} customer decisions are open (${blocked.length} quotes blocked). Pass --decisions.`);
      if (nameClashes.length) throw new Error(`Refusing: ${nameClashes.length} quote numbers would clash on BC Air's template`);
      if (journalsOnQuotes) throw new Error('Refusing: a journal points at a quote being moved');
      const now = new Date();
      for (const t of toCreate) {
        await c.query(
          `insert into "Customer" (id, "customerCode", name, email, phone, address, "gstRegNo", uen, "externalRef", currency, "organizationId", "createdAt", "updatedAt")
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
          [t.newId, t.code, t.name, t.email, t.phone, t.address, t.gstRegNo, t.uen, t.externalRef, t.currency, BCAIR, now],
        );
      }
      for (const x of ready) {
        const m = mapping.get(x.config.customerId)!;
        const tnc = typeof x.config.termsAndConditions === 'string' ? fixMojibake(x.config.termsAndConditions) : null;
        const patch = {
          ...(tnc && tnc.fixes ? { termsAndConditions: tnc.text } : {}),
          customerId: m.bcId,
          customerName: m.bcName,
          customerCode: m.bcCode ?? '',
          company: bcCompany,
          gstRegNo: bcOrg.registrationNumber ?? '',
          movedFrom: { organizationId: WCT, wctCustomerId: x.config.customerId, wctTemplateId: x.documentTemplateId, at: now.toISOString(), by: 'script', reason: '(NG) quotation belongs to BC Air' },
        };
        await c.query(
          `update "Document" set "organizationId" = $2, "documentTemplateId" = $3, "listCustomerId" = $4, config = config || $5::jsonb, "updatedAt" = $6
           where id = $1 and "organizationId" = $7 and type = 'QUOTATION'`,
          [x.id, BCAIR, bcTemplate.id, m.bcId, JSON.stringify(patch), now, WCT],
        );
      }
      await c.query(
        `update "DocumentEmbedding" e set "organizationId" = $2, "customerId" = d."listCustomerId"
         from "Document" d where d.id::text = e."documentId"::text and d.id::text = any($1::text[])`,
        [ids, BCAIR],
      );
      for (const l of links) {
        await c.query(
          `update "Document" set config = config || $2::jsonb, "updatedAt" = $3
           where id = $1 and "organizationId" = $4 and type = 'INVOICE' and coalesce(config->>'sourceDocumentId','') = ''`,
          [l.invoiceId, JSON.stringify({ sourceDocumentId: l.quoteId, sourceDocumentType: 'QUOTATION', sourceDocumentNumber: l.quoteNo }), now, BCAIR],
        );
      }
      const after = await counts();
      const ok =
        JSON.stringify(after.journals) === JSON.stringify(before.journals) &&
        after.quotations.BCAIR === projected.quotations.BCAIR &&
        after.customers.BCAIR === projected.customers.BCAIR &&
        after.invoicesWithSource === projected.invoicesWithSource;
      (summary as any).after = after;
      if (!ok) throw new Error(`After-check failed: ${JSON.stringify({ before, projected, after })}`);
      await c.query('COMMIT');
    }

    // ------------------------------------------------------------ files
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(
      path.join(OUT, 'held-quotes.csv'),
      csv(held.map(({ qt, real }) => ({ quoteNo: qt.name, date: qt.listIssueDate ?? '', customer: qt.config.customerName, total: qt.config.totalWithTax, subject: qt.config.subject, invoices: real.map((i: any) => `${i.name} ${i.status} ${i.total}`).join(' | ') }))),
    );
    fs.writeFileSync(path.join(OUT, 'code-only-customers.csv'), csv(codeOnly));
    fs.writeFileSync(path.join(OUT, 'ambiguous-name-customers.csv'), csv(ambiguousName));
    fs.writeFileSync(path.join(OUT, 'new-customers.csv'), csv(toCreate.map(({ newId, ...t }) => t)));
    fs.writeFileSync(path.join(OUT, 'unmatched-quotes.csv'), csv(unmatched));
    fs.writeFileSync(path.join(OUT, 'invoice-links.csv'), csv(links));
    fs.writeFileSync(path.join(OUT, 'link-conflicts.csv'), csv(conflicts));
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nFiles: ${OUT}`);
    console.log(APPLY ? 'Applied.' : 'Dry run. Nothing was written.');
  } catch (e) {
    if (APPLY) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
