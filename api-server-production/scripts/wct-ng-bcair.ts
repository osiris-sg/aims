/**
 * "ALL NG DOCUMENTS > BC AIR" (WCT group, owner + finance 2026-11-25). WCT (S) and BC Air only.
 * DRY RUN BY DEFAULT: one read-only transaction, nothing written, nothing deleted in S3.
 *
 * Selection (src/common/wct-ng.ts): every WCT (S) invoice with "(NG)" in its subject, plus (listed only) the ones
 * the ERP links to a BC Air quotation without the mark.
 *   - $1 placeholders (ERP-imported, "(NG)", total $1.00 / $1.07 / $1.08): REMOVED. Their live journals are VOIDED
 *     in place the app's way (status VOID, voidedAt / voidedBy; rows kept), then the documents are deleted (the DB
 *     guard aims_doc_delete_guard refuses a delete while a journal is live, so voids always go first). Pills on BC
 *     Air orders and links on WCT (S) orders go; notifications, embeddings, share / sign links and their own S3
 *     files go (S3 copies saved to the log folder first).
 *   - $0.00 "(NG)" invoices: MOVED (default) or removed with --zero remove.
 *   - real "(NG)" invoices: MOVED to BC Air, numbers kept (I-0xxxxx), customer mapped (UEN, then exact name; else
 *     created in BC Air; the WCT (S) customer is never deleted), BC Air's invoice template / company block, the
 *     pill becomes the BC Air order's own invoice (no order: ORD-Q-<quote no.> made like the import; no BC Air
 *     quotation: moved without an order). Journals (invoice, ERP payment, ERP credit note) move with them, same
 *     amounts and dates, accounts mapped by role / revenue stream / name. Payment lines on a WCT (S) bank need a
 *     bank-side option (--bank A|B|C, see the report). "Moved from WCT (S)" Activity Log rows in both companies.
 *   HELD (listed, nothing written): a BC Air twin invoice already names it (moving would bill the job twice); it sits
 *   on a WCT (S) order (its quotation is WCT (S)'s); an account that does not map; a number or journal number that
 *   clashes in BC Air; a move that would bill a BC Air order over its quotation total; payment / receipt rows.
 * Refuses on apply: any other row pointing at a document being removed (full id sweep); an open decision.
 *
 *   TZ=UTC npx ts-node --transpile-only scripts/wct-ng-bcair.ts                         # dry run (prod, read only)
 *   ... [--zero move|remove] [--include-linked] [--bank A|B|C] [--keep-abss-balances] [--batch <erp batch>]
 *   ... --apply --confirm-prod                                                          # owner APPLY
 *   ... --rollback <log.json> [--apply --confirm-prod]
 * --batch limits the selection to one ERP import batch (the weekly catch-up's step 2b).
 * Reads PROD_DATABASE_URL from .env (never printed).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Client, types } from 'pg';
import { ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { classifyNgInvoice, ngActionOf, ngSubjectOf, mapAccount, ngR2 as R2, NgClass, CoaRow } from '../src/common/wct-ng';
import { grossOf, owedOf, amountPaidOf, outstandingOf } from '../src/common/document-money';
import { erpImportOf } from '../src/common/erp-import';
import { matchCustomer } from '../src/gst-switch/gst-switch';
import { loadImportedOrderInputs, importedStatusFrom, crossOrgInvoiceRefsOf, isImportedOrder, IMPORTED_ORDER_SOURCE } from '../src/orders/imported-orders';

types.setTypeParser(1114, (v: string) => `${v.replace(' ', 'T')}Z`); // naive timestamps stay UTC text
types.setTypeParser(1700, (v: string) => Number(v));
types.setTypeParser(20, (v: string) => Number(v));

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const ORG_NAME: Record<string, string> = { [WCT]: 'WCT (S)', [BC]: 'BC Air' };
const SCRIPT = 'system:wct-ng-bcair';
const BATCH_MARK = 'wct-ng-bcair-2026-11-25';
const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2', 'TAX_INVOICE', 'INV'];

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const APPLY = argv.includes('--apply');
const CONFIRM = argv.includes('--confirm-prod');
const ROLLBACK = one('--rollback');
const ZERO = (one('--zero', 'move') as 'move' | 'remove');
const INCLUDE_LINKED = argv.includes('--include-linked');
const BANK = one('--bank') as 'A' | 'B' | 'C' | undefined;
const KEEP_ABSS = !argv.includes('--no-keep-abss-balances');
// Placeholders whose ledger is more than the $1 (an ABSS sale under the same number, a payment larger than the invoice):
// held by default; --detach-ledger keeps those journals posted (detached from the document) and removes the document.
const DETACH = argv.includes('--detach-ledger');
const ONLY_BATCH = one('--batch');
const DAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Singapore date (file names)
const OUT_DIR = one('--out', path.join(os.homedir(), 'Desktop/aims-agents/logs/wct'))!;
const STEM = `wct-ng-bcair-${APPLY ? 'APPLY' : 'DRYRUN'}-${DAY}${ONLY_BATCH ? '-' + ONLY_BATCH : ''}${ZERO === 'remove' ? '-zero-remove' : ''}${one('--tag') ? '-' + one('--tag') : ''}`;
const CSV_DIR = path.join(OUT_DIR, STEM);
// The ERP's own invoice -> quotation links: the round 8 read, every catch-up's merged list and every pulled invoice
// export (a later pull wins). --erp-links adds one more file (invoice_no, erp_quotation_no).
const IMPORTS = path.join(os.homedir(), 'Desktop/aims/_imports/wct');
const linkFiles = (): string[] => {
  const pulls = fs.existsSync(path.join(IMPORTS, 'erp-catchup')) ? fs.readdirSync(path.join(IMPORTS, 'erp-catchup')).filter((f) => /^\d{4}-\d{2}-\d{2}/.test(f)).sort() : [];
  const files = [path.join(IMPORTS, 'links/quotation-links.csv')];
  for (const p of pulls) files.push(path.join(IMPORTS, 'erp-catchup', p, 'quotation-links-merged.csv'), path.join(IMPORTS, 'erp-catchup', p, 'wct-invoices-full.csv'));
  if (one('--erp-links')) files.push(one('--erp-links')!);
  return files.filter((f) => fs.existsSync(f));
};
function readCsv(file: string): Array<Record<string, string>> {
  const text = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [], f = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows.filter((r) => r.length > 1);
  return (b || []).map((r) => Object.fromEntries((h || []).map((k, i) => [k, r[i] ?? ''])));
}
if (!['move', 'remove'].includes(ZERO)) throw new Error('--zero move|remove');
if (BANK && !['A', 'B', 'C'].includes(BANK)) throw new Error('--bank A|B|C');

function prodUrl(): string {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('PROD_DATABASE_URL='));
  if (!line) throw new Error('PROD_DATABASE_URL missing in .env');
  return line.slice('PROD_DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}
function s3(): { client: S3Client; bucket: string } {
  const env = Object.fromEntries(
    fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
  );
  return {
    client: new S3Client({ region: env.AWS_REGION || 'ap-southeast-1', credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY } }),
    bucket: env.RESOURCE_BUCKET || 'aims-osiris',
  };
}

const money = (n: number) => (Number(n) || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const writeCsv = (file: string, cols: string[], rows: any[]) =>
  fs.writeFileSync(file, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
/** ERP quotation key "-014923" / "Q-14923" -> "Q-014923". */
const qName = (v: unknown): string | null => {
  const m = /(\d{1,7})\s*$/.exec(String(v ?? '').trim());
  return m ? `Q-${m[1].padStart(6, '0')}` : null;
};
const sample = <T>(xs: T[], n = 10): T[] => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]));
const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type Inv = {
  id: string;
  name: string;
  status: string;
  templateId: string;
  listCustomerId: string | null;
  createdAt: string;
  config: any;
  subject: string;
  gross: number;
  owed: number;
  paid: number;
  date: string;
  customerName: string;
  cls: NgClass;
  action: 'remove' | 'move' | 'keep';
  linkedQuote: string | null;
  linkedQuoteOrg: string | null;
  holds: string[];
};

(async () => {
  if (APPLY && !CONFIRM) throw new Error('prod --apply needs --confirm-prod');
  const c = new Client({ connectionString: prodUrl() });
  await c.connect();
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => (await c.query(sql, p)).rows as T[];
  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };
  if (ROLLBACK) return rollback(c, q, say);
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  await c.query(APPLY ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  let committed = false;
  fs.mkdirSync(CSV_DIR, { recursive: true });
  try {
    // ── 0. orgs, templates, charts ────────────────────────────────────────
    const orgRows = await q(`select id, name, address, "phoneNumber", "registrationNumber" from "Organization" where id = any($1)`, [[WCT, BC]]);
    const orgOf = new Map(orgRows.map((o: any) => [o.id, o]));
    if (orgOf.size !== 2) throw new Error('WCT (S) / BC Air not found');
    const bcTpl = (await q(`select "documentTemplateId" id, count(*)::int n from "Document" where "organizationId" = $1 and type = 'INVOICE' group by 1 order by 2 desc limit 1`, [BC]))[0]?.id;
    if (!bcTpl) throw new Error('BC Air has no invoice template in use');
    const controls = new Map((await q(`select "organizationId" o, "controlAccounts" ca from "AccountingSetting" where "organizationId" = any($1)`, [[WCT, BC]])).map((r: any) => [r.o, r.ca || {}]));
    const coa = await q(`select id, "organizationId" org, code, name, "accountType", category, "isActive" from "ChartOfAccount" where "organizationId" = any($1)`, [[WCT, BC]]);
    const acctById = new Map(coa.map((a: any) => [a.id, a]));
    const bcByCode = new Map(coa.filter((a: any) => a.org === BC).map((a: any) => [a.code, a]));
    const wctByCode = new Map(coa.filter((a: any) => a.org === WCT).map((a: any) => [a.code, a]));
    const bcUsage = new Map(
      (await q(`select a.code, count(*)::int n from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId" join "ChartOfAccount" a on a.id = l."accountId" where j."organizationId" = $1 and j.type = 'INVOICE' group by 1`, [BC])).map((r: any) => [r.code, r.n]),
    );

    // ── 1. FIND ───────────────────────────────────────────────────────────
    const links = new Map<string, string>();
    let linkChanges = 0;
    const lf = linkFiles();
    for (const f of lf) {
      for (const r of readCsv(f)) {
        const inv = String(r.invoice_no ?? '').trim();
        const quote = qName(r.erp_quotation_no);
        if (!inv || !quote || !String(r.erp_quotation_no ?? '').trim()) continue;
        if (links.has(inv) && links.get(inv) !== quote) linkChanges++;
        links.set(inv, quote);
      }
    }
    const neverLink = new Set<string>(((JSON.parse(fs.readFileSync(path.join(__dirname, 'wct-erp-never-link.json'), 'utf8')).invoices || []) as any[]).map((x) => String(x.invoice)));
    const quotes = await q(`select id::text id, "organizationId" org, name, config->>'customerId' "customerId", config->>'subject' subject, config->>'totalWithTax' total, config->>'date' date, config->'erpImport'->>'clientSite' site, config->>'location' location from "Document" where "organizationId" = any($1) and type = 'QUOTATION'`, [[WCT, BC]]);
    const quoteByName = new Map<string, any[]>();
    for (const x of quotes) quoteByName.set(`${x.org}|${x.name}`, [...(quoteByName.get(`${x.org}|${x.name}`) ?? []), x]);

    const rows = await q(
      `select id::text id, name, status::text status, "documentTemplateId" "templateId", "listCustomerId", "createdAt", config - 'items' - 'termsAndConditions' config
         from "Document" where "organizationId" = $1 and upper(type::text) = any($2)`,
      [WCT, INVOICE_TYPES],
    );
    const invs: Inv[] = [];
    for (const d of rows) {
      const cfg = d.config || {};
      if (ONLY_BATCH && erpImportOf(cfg)?.batch !== ONLY_BATCH) continue;
      const subject = ngSubjectOf(cfg);
      const lq = neverLink.has(d.name) ? null : links.get(d.name) ?? null;
      const lqOrg = lq ? (quoteByName.has(`${BC}|${lq}`) ? BC : quoteByName.has(`${WCT}|${lq}`) ? WCT : null) : null;
      const gross = R2(Number(grossOf(cfg)) || 0);
      const cls = classifyNgInvoice({ subject, total: gross, erpImported: !!erpImportOf(cfg), linkedToNgQuotation: lqOrg === BC });
      if (cls === 'none') continue;
      const out = outstandingOf(cfg);
      invs.push({
        ...d,
        subject,
        gross,
        owed: R2(owedOf(cfg)),
        paid: R2(Number(amountPaidOf(cfg)) || (out == null ? 0 : gross - Number(out))),
        date: String(cfg.date ?? cfg.documentInfo?.date ?? '').slice(0, 10),
        customerName: String(cfg.customerName ?? cfg.customer?.name ?? ''),
        cls,
        action: ngActionOf(cls, { zero: ZERO, includeLinked: INCLUDE_LINKED }),
        linkedQuote: lq,
        linkedQuoteOrg: lqOrg,
        holds: [],
      });
    }
    const byId = new Map(invs.map((d) => [d.id, d]));
    const ids = invs.map((d) => d.id);
    const names = invs.map((d) => d.name);

    // Everything hanging off them.
    const bcOrders = await q(`select id::text id, "orderNumber", status, "customerId"::text "customerId", "sourceQuotationId"::text "sourceQuotationId", "linkedDocuments" from "Order" where "organizationId" = $1`, [BC]);
    const wctOrders = await q(
      `select id::text id, "orderNumber", status, "sourceQuotationId"::text "sourceQuotationId", "linkedDocuments", "invoiceDocumentId"::text "invoiceDocumentId" from "Order"
        where "organizationId" = $1 and ("invoiceDocumentId"::text = any($2) or exists (select 1 from jsonb_array_elements(coalesce("linkedDocuments"->'invoice','[]')) x where x->>'id' = any($2)))`,
      [WCT, ids],
    );
    const pillsOf = new Map<string, any[]>();
    for (const o of bcOrders) for (const r of crossOrgInvoiceRefsOf(o)) if (byId.has(r.id)) pillsOf.set(r.id, [...(pillsOf.get(r.id) ?? []), o]);
    const wctOrderOf = new Map<string, any[]>();
    for (const o of wctOrders) for (const r of [...((o.linkedDocuments?.invoice ?? []) as any[]).map((x) => x?.id), o.invoiceDocumentId]) if (r && byId.has(r)) wctOrderOf.set(r, [...(wctOrderOf.get(r) ?? []), o]);
    const bcOrderByQuote = new Map<string, any[]>();
    for (const o of bcOrders) if (o.sourceQuotationId && o.status !== 'CANCELLED') bcOrderByQuote.set(o.sourceQuotationId, [...(bcOrderByQuote.get(o.sourceQuotationId) ?? []), o]);

    const journals = await q(
      `select j.id, j."journalNumber", j.type, j.status, j."entryDate", j.reference, j.description, j."sourceDocumentId", j."sourcePaymentId", j."createdBy", j."totalDebit"
         from "JournalEntry" j where j."organizationId" = $1 and j.status <> 'VOID' and (j."sourceDocumentId" = any($2) or (j.type = 'CREDIT_NOTE' and substring(j.description from ' on (I-[0-9]+)') = any($3)))`,
      [WCT, ids, names],
    );
    const nameToId = new Map(invs.map((d) => [d.name, d.id]));
    for (const j of journals) j.docId = j.sourceDocumentId ?? nameToId.get(/ on (I-\d+)/.exec(String(j.description))?.[1] ?? '') ?? null;
    const jLines = journals.length
      ? await q(`select l.id, l."journalEntryId" je, l."accountId", l.debit, l.credit, l."costCenterId" from "JournalEntryLine" l where l."journalEntryId" = any($1)`, [journals.map((j) => j.id)])
      : [];
    const linesOf = new Map<string, any[]>();
    for (const l of jLines) linesOf.set(l.je, [...(linesOf.get(l.je) ?? []), l]);
    const journalsOf = new Map<string, any[]>();
    for (const j of journals) if (j.docId) journalsOf.set(j.docId, [...(journalsOf.get(j.docId) ?? []), j]);

    const count = async (sql: string, p: unknown[]) => (await q(sql, p)).map((r: any) => r.id as string);
    const receiptRefs = await q(
      `select r.id::text id, r.name, a->>'documentId' doc, a->>'reference' ref from "Document" r, jsonb_array_elements(coalesce(r.config->'allocations','[]')) a
        where r."organizationId" = $1 and r.type in ('OFFICIAL_RECEIPT','RECEIPT','CREDIT_NOTE','CN') and (a->>'documentId' = any($2) or a->>'reference' = any($3))`,
      [WCT, ids, names],
    );
    const payments = await q(`select id, "documentId"::text doc, amount from "Payment" where "documentId"::text = any($1)`, [ids]);
    const txns = await count(`select id from "Transaction" where "documentId"::text = any($1)`, [ids]);
    const jobs = await count(`select id::text id from "Delivery" where "documentId"::text = any($1) or "orderInvoiceId"::text = any($1)`, [ids]);
    const srs = await count(`select id::text id from "MaintenanceServiceReport" where "documentId"::text = any($1) or "invoiceDocumentId"::text = any($1)`, [ids]);
    const notifs = await q(`select id, "entityId" doc from "Notification" where "entityId" = any($1)`, [ids]);
    const embeds = await q(`select id, "documentId"::text doc from "DocumentEmbedding" where "documentId"::text = any($1)`, [ids]);
    const shareLinks = await q(`select id, "documentId"::text doc from "DocumentShareLink" where "documentId"::text = any($1)`, [ids]).catch(() => [] as any[]);
    const signLinks = await q(`select id, "documentId"::text doc from "DocumentSignLink" where "documentId"::text = any($1)`, [ids]).catch(() => [] as any[]);
    const childDocs = await q(`select id::text id, type, name, coalesce(config->>'sourceDocumentId', "baseDocumentId"::text) src from "Document" where (config->>'sourceDocumentId' = any($1) or "baseDocumentId"::text = any($1)) and not (id::text = any($1))`, [ids]);
    const twins = await q(
      `select id::text id, name, coalesce(config->>'totalWithTax', config->>'nettTotal') total, coalesce(config->>'referenceNo', config->>'reference', config->'documentInfo'->>'referenceNo') ref from "Document"
        where "organizationId" = $1 and upper(type::text) = any($2) and coalesce(config->>'referenceNo', config->>'reference', config->'documentInfo'->>'referenceNo') = any($3)`,
      [BC, INVOICE_TYPES, names],
    );
    const twinOf = new Map<string, any[]>();
    for (const t of twins) twinOf.set(t.ref, [...(twinOf.get(t.ref) ?? []), t]);
    const wctDos = await q(
      `select id::text id, name, config->>'orderNo' "orderNo", config->>'quotationNo' quote, config->'erpImport'->'invoices' invs from "Document"
        where "organizationId" = $1 and type = 'DELIVERY_ORDER' and exists (select 1 from jsonb_array_elements_text(coalesce(config->'erpImport'->'invoices','[]')) x where x = any($2))`,
      [WCT, names],
    );
    const bcNameClash = new Set((await q(`select name from "Document" where "organizationId" = $1 and "documentTemplateId" = $2 and name = any($3)`, [BC, bcTpl, names])).map((r: any) => r.name));
    const bcJournalNos = new Set((await q(`select "journalNumber" n from "JournalEntry" where "organizationId" = $1 and "journalNumber" = any($2)`, [BC, journals.map((j) => j.journalNumber)])).map((r: any) => r.n));

    // ── 2. PLAN ───────────────────────────────────────────────────────────
    // Account mapping (every account a moving journal touches).
    const mapCtx = { srcControls: controls.get(WCT) || {}, dstControls: controls.get(BC) || {}, dst: coa.filter((a: any) => a.org === BC) as CoaRow[], dstUsage: bcUsage };
    const acctMap = new Map<string, any>();
    const mapOf = (accountId: string) => {
      if (!acctMap.has(accountId)) {
        const a = acctById.get(accountId);
        acctMap.set(accountId, { src: a, ...mapAccount(a, mapCtx) });
      }
      return acctMap.get(accountId);
    };
    const bankSide = (BANK ?? null) as 'A' | 'B' | 'C' | null;
    const intercoWct = wctByCode.get('1-3203'); // INTERB - BCA (WCT (S)'s current account with BC Air)
    const intercoBc = bcByCode.get(BANK === 'C' ? '1-2430' : '1-3300'); // C: "WCT (S) - OCBC Bank (WCT Cleaning)"; A / B: "Other Rec - WCT (S) Systems"
    const bcDebtors = bcByCode.get((controls.get(BC) || {}).debtorControl);
    const wctDebtors = wctByCode.get((controls.get(WCT) || {}).debtorControl);

    // A placeholder's journal that is real money: an ABSS (WCT (S)'s books) sale under the same number, or a payment
    // larger than the invoice (a real receipt booked against the placeholder in the ERP).
    const ledgerHeavy = (d: Inv) =>
      (journalsOf.get(d.id) ?? [])
        .map((j) => {
          const dr = R2((linesOf.get(j.id) ?? []).reduce((t, l) => t + l.debit, 0));
          if (String(j.createdBy).startsWith('abss')) return { j, why: `${j.journalNumber} S$${money(dr)} in ABSS` };
          if (j.type === 'PAYMENT' && dr > d.gross + 0.005) return { j, why: `${j.journalNumber} received S$${money(dr)} on a S$${money(d.gross)} invoice` };
          return null;
        })
        .filter(Boolean) as Array<{ j: any; why: string }>;
    for (const d of invs) {
      if (d.action === 'keep') continue;
      if (payments.some((p) => p.doc === d.id)) d.holds.push('payment rows');
      if (receiptRefs.some((r) => r.doc === d.id || r.ref === d.name)) d.holds.push(`on receipt / credit note ${receiptRefs.filter((r) => r.doc === d.id || r.ref === d.name).map((r) => r.name).join(', ')}`);
      if (childDocs.some((x) => x.src === d.id)) d.holds.push(`documents made from it: ${childDocs.filter((x) => x.src === d.id).map((x) => `${x.type} ${x.name}`).join(', ')}`);
      if (d.action === 'remove') {
        const heavy = ledgerHeavy(d);
        if (heavy.length && !DETACH) d.holds.push(`ledger is more than the placeholder: ${heavy.map((j) => j.why).join('; ')} (finance; --detach-ledger keeps these journals posted and removes the document)`);
      }
      if (d.action !== 'move') continue;
      const tw = twinOf.get(d.name) ?? [];
      if (tw.length) d.holds.push(`BC Air already has ${tw.map((t) => `${t.name} ($${money(Number(t.total))})`).join(', ')} naming it (moving would bill the job twice)`);
      if (wctOrderOf.has(d.id) && d.linkedQuoteOrg !== BC) d.holds.push(`on WCT (S) order ${wctOrderOf.get(d.id)!.map((o) => o.orderNumber).join(', ')} (its quotation ${d.linkedQuote ?? ''} is WCT (S)'s)`);
      if (bcNameClash.has(d.name)) d.holds.push(`number ${d.name} already used in BC Air`);
      for (const j of journalsOf.get(d.id) ?? []) {
        if (bcJournalNos.has(j.journalNumber)) d.holds.push(`journal ${j.journalNumber} already in BC Air`);
        for (const l of linesOf.get(j.id) ?? []) {
          const m = mapOf(l.accountId);
          if (m.code) continue;
          if (m.bank && bankSide) continue;
          d.holds.push(m.bank ? `journal ${j.journalNumber}: received into WCT (S) ${m.src.code} ${m.src.name} (needs --bank A|B|C)` : `journal ${j.journalNumber}: ${m.src.code} ${m.src.name} has no BC Air account (${m.why})`);
        }
      }
    }

    // Customers for the moves.
    const movers = () => invs.filter((d) => d.action === 'move' && !d.holds.length);
    const wctCustIds = [...new Set(invs.filter((d) => d.action === 'move').map((d) => d.config.customerId).filter(Boolean))];
    const wctCust = wctCustIds.length ? await q(`select * from "Customer" where "organizationId" = $1 and id::text = any($2)`, [WCT, wctCustIds]) : [];
    const wctCustById = new Map(wctCust.map((x: any) => [x.id, x]));
    const bcCust = await q(`select id::text id, name, uen, "customerCode", email from "Customer" where "organizationId" = $1`, [BC]);
    const taken = new Set<string>(bcCust.map((b: any) => b.customerCode).filter(Boolean));
    const takenEmail = new Set<string>(bcCust.map((b: any) => String(b.email || '').toLowerCase()).filter(Boolean));
    const nextCode = (name: string) => {
      const letter = name?.normalize('NFD').toUpperCase().match(/[A-Z0-9]/)?.[0] || 'X';
      let max = 0;
      for (const code of taken) {
        const m = new RegExp(`^C${letter}(\\d+)$`).exec(code);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      return `C${letter}${String(max + 1).padStart(3, '0')}`;
    };
    const custMap = new Map<string, { id: string; name: string; code: string | null; how: string }>();
    const custCreate: any[] = [];
    for (const id of wctCustIds) {
      const w = wctCustById.get(id);
      if (!w) continue;
      const hit = matchCustomer({ name: w.name, uen: w.uen }, bcCust);
      if (hit) {
        custMap.set(id, { id: hit.id, name: hit.name, code: hit.customerCode, how: w.uen && hit.uen && String(hit.uen).toUpperCase().replace(/\s+/g, '') === String(w.uen).toUpperCase().replace(/\s+/g, '') ? 'UEN' : 'exact name' });
        continue;
      }
      let code = w.customerCode || null;
      const codeNote = !code ? 'issued' : taken.has(code) ? `re-issued (${code} is taken in BC Air)` : 'kept';
      if (!code || taken.has(code)) code = nextCode(w.name);
      taken.add(code!);
      let email = (w.email || '').trim() || null;
      if (email && takenEmail.has(email.toLowerCase())) email = null;
      if (email) takenEmail.add(email.toLowerCase());
      const nid = randomUUID();
      custCreate.push({ id: nid, wctId: id, name: w.name, code, codeNote, email, phone: w.phone, address: w.address, gstRegNo: w.gstRegNo, uen: w.uen, externalRef: w.externalRef, currency: w.currency || 'SGD' });
      custMap.set(id, { id: nid, name: w.name, code, how: 'create' });
    }
    for (const d of invs) if (d.action === 'move' && !d.holds.length && !custMap.has(d.config.customerId)) d.holds.push(`customer ${d.config.customerId ?? '(none)'} not found in WCT (S)`);

    // Orders: where each mover lands; pills / WCT order links that go.
    type OrderPlan = { order: any; org: string; create?: boolean; ld: any; add: Inv[]; drop: Inv[] };
    const orderPlans = new Map<string, OrderPlan>();
    const planFor = (o: any, org: string, create = false): OrderPlan => {
      if (!orderPlans.has(o.id)) orderPlans.set(o.id, { order: o, org, create, ld: JSON.parse(JSON.stringify(o.linkedDocuments || {})), add: [], drop: [] });
      return orderPlans.get(o.id)!;
    };
    const quoteById = new Map(quotes.map((x: any) => [x.id, x]));
    const newOrders: any[] = [];
    const landing = new Map<string, string>(); // invoice id -> order number / 'no order'
    for (const d of invs.filter((x) => x.action === 'move' && !x.holds.length)) {
      const pills = pillsOf.get(d.id) ?? [];
      const bq = d.linkedQuoteOrg === BC ? quoteByName.get(`${BC}|${d.linkedQuote}`) ?? [] : [];
      let target: any = pills[0] ?? null;
      if (pills.length > 1) { d.holds.push(`pill on several BC Air orders ${pills.map((o) => o.orderNumber).join(', ')}`); continue; }
      if (!target && bq.length === 1) {
        const os2 = bcOrderByQuote.get(bq[0].id) ?? [];
        if (os2.length > 1) { d.holds.push(`several BC Air orders for ${d.linkedQuote}`); continue; }
        target = os2[0] ?? null;
        // A $0 invoice never makes an order (it would read Part billed 0% against the whole quotation).
        if (!target && Math.abs(d.gross) >= 0.005) {
          const num = `ORD-${d.linkedQuote}`;
          if (bcOrders.some((o) => o.orderNumber === num) || newOrders.some((o) => o.orderNumber === num)) { d.holds.push(`order number ${num} already used in BC Air`); continue; }
          const qt = bq[0];
          target = { id: randomUUID(), orderNumber: num, status: 'INVOICED', customerId: qt.customerId, sourceQuotationId: qt.id, linkedDocuments: { po: [], do: [], salesOrder: [], invoice: [], creditNote: [], imported: { source: IMPORTED_ORDER_SOURCE, batch: BATCH_MARK, quotationNo: qt.name, linkSources: {}, erpDoNumbers: [], customerMismatch: [], subject: String(qt.subject ?? '').trim() || null, site: String(qt.site ?? qt.location ?? '').trim() || null, quoteTotal: Number(qt.total ?? 0) || 0, partBilledRule: true, at: new Date().toISOString() } }, date: qt.date };
          newOrders.push(target);
          planFor(target, BC, true);
        }
      } else if (!target && bq.length > 1) { d.holds.push(`${bq.length} BC Air quotations ${d.linkedQuote}`); continue; }
      if (target) {
        const p = planFor(target, BC, newOrders.includes(target));
        p.add.push(d);
        landing.set(d.id, target.orderNumber);
      } else landing.set(d.id, bq.length ? `no order ($0 invoice: none made for ${d.linkedQuote})` : 'no order (no BC Air quotation)');
      for (const o of wctOrderOf.get(d.id) ?? []) planFor(o, WCT).drop.push(d);
    }
    for (const d of invs.filter((x) => x.action === 'remove' && !x.holds.length)) {
      for (const o of pillsOf.get(d.id) ?? []) planFor(o, BC).drop.push(d);
      for (const o of wctOrderOf.get(d.id) ?? []) planFor(o, WCT).drop.push(d);
    }
    // Next linkedDocuments.
    for (const p of orderPlans.values()) {
      const dropIds = new Set([...p.drop, ...p.add].map((d) => d.id));
      const ld = p.ld;
      if (Array.isArray(ld.crossOrgInvoice)) ld.crossOrgInvoice = ld.crossOrgInvoice.filter((x: any) => !dropIds.has(x?.id));
      if (p.org === WCT) {
        if (Array.isArray(ld.invoice)) ld.invoice = ld.invoice.filter((x: any) => !dropIds.has(x?.id));
        if (ld.imported?.linkSources) for (const id of dropIds) delete ld.imported.linkSources[id];
      }
      if (p.add.length) {
        ld.invoice = [...(Array.isArray(ld.invoice) ? ld.invoice : []), ...p.add.map((d) => ({ id: d.id, name: d.name, total: d.gross, templateId: bcTpl }))];
        if (ld.imported) ld.imported.linkSources = { ...(ld.imported.linkSources || {}), ...Object.fromEntries(p.add.map((d) => [d.id, 'moved-from-wct'])) };
      }
    }

    // Billed / Left to bill / status before and after (the order page's own reads, the "after" one simulated).
    const removeIds = new Set(invs.filter((d) => d.action === 'remove' && !d.holds.length).map((d) => d.id));
    const moveIds = () => new Set(movers().map((d) => d.id));
    const simPrisma = (after: boolean) => ({
      $queryRawUnsafe: (sql: string, ...p: any[]) => q(sql, p),
      document: {
        findMany: async (args: any) => {
          const org = args?.where?.organizationId;
          const want: string[] = args?.where?.id?.in ?? [];
          if (!want.length) return [];
          const got = await q(`select id::text id, "organizationId" org, name, type, status::text status, "documentTemplateId", config, "createdAt" from "Document" where id::text = any($1)`, [want]);
          const mv = moveIds();
          return got.filter((r: any) => {
            if (!after) return r.org === org;
            if (removeIds.has(r.id)) return false;
            if (mv.has(r.id)) return org === BC; // a moved invoice reads as BC Air's
            return r.org === org;
          });
        },
      },
    });
    const orderDos = new Map<string, any[]>();
    const plans = [...orderPlans.values()];
    if (plans.length) {
      const dos = await q(`select id::text id, name, type, status::text status, "documentTemplateId", config - 'items' config, "createdAt" from "Document" where type in ('DELIVERY_ORDER','DO') and config->>'orderId' = any($1)`, [plans.map((p) => p.order.id)]);
      for (const d of dos) orderDos.set(d.config.orderId, [...(orderDos.get(d.config.orderId) ?? []), d]);
    }
    let statusRows: any[] = [];
    const computeStatus = async (): Promise<number> => {
      statusRows = [];
      let newHolds = 0;
      for (const org of [BC, WCT]) {
        const ps = plans.filter((p) => p.org === org);
        for (const part of chunks(ps, 200)) {
          const before = await loadImportedOrderInputs(simPrisma(false), org, part.filter((p) => !p.create).map((p) => ({ id: p.order.id, sourceQuotationId: p.order.sourceQuotationId, linkedDocuments: p.order.linkedDocuments })), { orderDos });
          const after = await loadImportedOrderInputs(simPrisma(true), org, part.map((p) => ({ id: p.order.id, sourceQuotationId: p.order.sourceQuotationId, linkedDocuments: p.ld })), { orderDos });
          for (const p of part) {
            const imported = isImportedOrder(p.order);
            const b = p.create || !imported ? null : importedStatusFrom(p.order, before.get(p.order.id)!);
            const a = imported ? importedStatusFrom({ linkedDocuments: p.ld }, after.get(p.order.id)!) : null;
            const row = {
              org: ORG_NAME[org], order: p.order.orderNumber, orderId: p.order.id, created: !!p.create, imported,
              added: p.add.map((d) => d.name).join(' '), dropped: p.drop.map((d) => d.name).join(' '),
              statusBefore: p.create ? '(new)' : p.order.status, statusAfter: a?.status ?? p.order.status,
              billedBefore: b?.billed ?? null, billedAfter: a?.billed ?? null, quoteTotal: a?.quoteTotal ?? b?.quoteTotal ?? null,
              leftBefore: b && b.quoteTotal != null ? R2(b.quoteTotal - b.billed) : null, leftAfter: a && a.quoteTotal != null ? R2(a.quoteTotal - a.billed) : null,
            } as any;
            // Over-billing: the adds would bill the order over its quotation total (and it was not over before): hold them.
            const overBefore = !!b && b.quoteTotal != null && b.billed > b.quoteTotal + 0.01;
            if (a && a.quoteTotal != null && a.billed > a.quoteTotal + 0.01 && !overBefore && p.add.length) {
              for (const d of p.add) { d.holds.push(`would bill ${p.order.orderNumber} over its quotation (${money(a.billed)} of ${money(a.quoteTotal)})`); newHolds++; }
            }
            statusRows.push(row);
          }
        }
      }
      return newHolds;
    };
    const releaseHeld = () => {
      // Adds held by a check come off the plans (the pill stays; order plans keep their other changes).
      for (const p of plans) {
        const held = p.add.filter((d) => d.holds.length);
        if (!held.length) continue;
        p.add = p.add.filter((d) => !d.holds.length);
        const heldIds = new Set(held.map((d) => d.id));
        p.ld.invoice = (p.ld.invoice || []).filter((x: any) => !heldIds.has(x.id));
        if (p.ld.imported?.linkSources) for (const id of heldIds) delete p.ld.imported.linkSources[id];
        p.ld.crossOrgInvoice = [...(p.ld.crossOrgInvoice || []), ...crossOrgInvoiceRefsOf(p.order).filter((x) => heldIds.has(x.id))];
        for (const d of held) {
          landing.delete(d.id);
          for (const o of wctOrderOf.get(d.id) ?? []) { const wp = orderPlans.get(o.id); if (wp) wp.drop = wp.drop.filter((x) => x.id !== d.id); }
        }
      }
    };
    for (let round = 0; round < 3 && (await computeStatus()) > 0; round++) releaseHeld();
    const overHeld = invs.filter((d) => d.holds.some((h) => h.startsWith('would bill'))).length;

    // ── journals: voids (removals) and moves ───────────────────────────────
    const removing = invs.filter((d) => d.action === 'remove' && !d.holds.length);
    const moving = movers();
    const detachIds = new Set(removing.flatMap((d) => ledgerHeavy(d).map((x) => x.j.id)));
    const detachJ = removing.flatMap((d) => (journalsOf.get(d.id) ?? []).filter((j) => detachIds.has(j.id)));
    const voidJ = removing.flatMap((d) => (journalsOf.get(d.id) ?? []).filter((j) => !detachIds.has(j.id)));
    const moveJ = moving.flatMap((d) => (journalsOf.get(d.id) ?? []).map((j) => ({ j, d })));
    const plugDate = { [WCT]: '2023-12-31', [BC]: '2026-11-06' };
    // Ledger effect per company and account (posted balances = debit - credit).
    const effect = new Map<string, { org: string; code: string; name: string; before?: number; delta: number; prePlug: number; prePlugClosed: number }>();
    const openYear = { [WCT]: '2024-01-01', [BC]: '2026-01-01' };
    const bump = (org: string, code: string, name: string, amount: number, date: string) => {
      const k = `${org}|${code}`;
      const e = effect.get(k) ?? { org, code, name, delta: 0, prePlug: 0, prePlugClosed: 0 };
      e.delta = R2(e.delta + amount);
      if (date.slice(0, 10) <= plugDate[org]) e.prePlug = R2(e.prePlug + amount);
      if (date.slice(0, 10) < openYear[org]) e.prePlugClosed = R2(e.prePlugClosed + amount);
      effect.set(k, e);
    };
    for (const j of voidJ) for (const l of linesOf.get(j.id) ?? []) { const a = acctById.get(l.accountId); bump(WCT, a.code, a.name, -(l.debit - l.credit), j.entryDate); }
    const intercoJournals: any[] = [];
    for (const { j, d } of moveJ) {
      const staysInWct = bankSide === 'B' && (linesOf.get(j.id) ?? []).some((l) => mapOf(l.accountId).bank);
      for (const l of staysInWct ? [] : linesOf.get(j.id) ?? []) {
        const a = acctById.get(l.accountId);
        const m = mapOf(l.accountId);
        const amt = l.debit - l.credit;
        bump(WCT, a.code, a.name, -amt, j.entryDate);
        if (m.code) { const t = bcByCode.get(m.code); bump(BC, t.code, t.name, amt, j.entryDate); }
        else if (m.bank && bankSide && intercoBc) bump(BC, intercoBc.code, intercoBc.name, amt, j.entryDate);
      }
      // Bank side: what keeps both books right when the money landed in a WCT (S) bank.
      const bankLines = (linesOf.get(j.id) ?? []).filter((l) => mapOf(l.accountId).bank);
      if (bankLines.length && bankSide && intercoWct && intercoBc && bcDebtors && wctDebtors) {
        const amt = R2(bankLines.reduce((t, l) => t + (l.debit - l.credit), 0));
        if (bankSide === 'A' || bankSide === 'C') {
          // WCT (S) keeps its bank: Dr bank / Cr INTERB - BCA (owes BC Air).
          intercoJournals.push({ org: WCT, date: j.entryDate, ref: j.reference, number: `NG-IC-${j.journalNumber}`, d, lines: [...bankLines.map((l) => ({ account: acctById.get(l.accountId), debit: l.debit, credit: l.credit })), { account: intercoWct, debit: amt < 0 ? -amt : 0, credit: amt > 0 ? amt : 0 }] });
          for (const l of bankLines) { const a = acctById.get(l.accountId); bump(WCT, a.code, a.name, l.debit - l.credit, j.entryDate); }
          bump(WCT, intercoWct.code, intercoWct.name, -amt, j.entryDate);
        } else {
          // B: the receipt journal stays in WCT (S); WCT (S) moves the AR credit to INTERB - BCA, BC Air clears its AR against WCT (S).
          intercoJournals.push({ org: WCT, date: j.entryDate, ref: j.reference, number: `NG-IC-${j.journalNumber}`, d, lines: [{ account: wctDebtors, debit: amt > 0 ? amt : 0, credit: amt < 0 ? -amt : 0 }, { account: intercoWct, debit: amt < 0 ? -amt : 0, credit: amt > 0 ? amt : 0 }] });
          intercoJournals.push({ org: BC, date: j.entryDate, ref: j.reference, number: `NG-IC-${j.journalNumber}`, d, lines: [{ account: intercoBc, debit: amt > 0 ? amt : 0, credit: amt < 0 ? -amt : 0 }, { account: bcDebtors, debit: amt < 0 ? -amt : 0, credit: amt > 0 ? amt : 0 }] });
          bump(WCT, wctDebtors.code, wctDebtors.name, amt, j.entryDate); bump(WCT, intercoWct.code, intercoWct.name, -amt, j.entryDate);
          bump(BC, intercoBc.code, intercoBc.name, amt, j.entryDate); bump(BC, bcDebtors.code, bcDebtors.name, -amt, j.entryDate);
        }
      }
    }
    // --keep-abss-balances: one ADJUSTMENT per company at its ABSS opening date reverses the part dated before it, so
    // every balance from that date on stays equal to ABSS (P&L of closed years goes to retained earnings).
    const rebalance: any[] = [];
    if (KEEP_ABSS) {
      for (const org of [WCT, BC]) {
        const retained = (org === WCT ? wctByCode : bcByCode).get((controls.get(org) || {}).retainedProfits);
        const lines = new Map<string, number>();
        for (const e of effect.values()) {
          if (e.org !== org || Math.abs(e.prePlug) < 0.005) continue;
          const a = (org === WCT ? wctByCode : bcByCode).get(e.code);
          if (a?.category === 'PNL' && retained) {
            // Closed years' P&L sits in retained earnings; the open year's stays on its own account.
            lines.set(retained.code, R2((lines.get(retained.code) ?? 0) - e.prePlugClosed));
            lines.set(e.code, R2((lines.get(e.code) ?? 0) - (e.prePlug - e.prePlugClosed)));
          } else lines.set(e.code, R2((lines.get(e.code) ?? 0) - e.prePlug));
        }
        const ls = [...lines].filter(([, v]) => Math.abs(v) >= 0.005);
        if (ls.length) rebalance.push({ org, date: plugDate[org], lines: ls.map(([code, v]) => ({ code, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 })) });
        for (const [code, v] of ls) { const a = (org === WCT ? wctByCode : bcByCode).get(code); bump(org, code, a.name, v, '9999-12-31'); }
      }
    }
    for (const e of effect.values()) {
      const acct = (e.org === WCT ? wctByCode : bcByCode).get(e.code);
      const b = await q(`select coalesce(sum(l.debit - l.credit),0)::numeric(14,2) bal from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId" where j."organizationId" = $1 and j.status = 'POSTED' and l."accountId" = $2`, [e.org, acct.id]);
      e.before = Number(b[0].bal);
    }

    // AR per company (what the aged / AR reports read: owed on live invoices).
    const ar = async (org: string) => Number((await q(`select coalesce(sum(greatest(0, coalesce((config->>'outstandingBalance')::numeric, (config->>'xeroBalance')::numeric, coalesce((config->>'totalWithTax')::numeric,0) - coalesce((config->>'paidToDate')::numeric,0)))),0)::numeric(14,2) n from "Document" where "organizationId" = $1 and upper(type::text) = any($2) and status::text not in ('draft','unconfirmed','void') and coalesce(config->>'voided','') <> 'true'`, [org, INVOICE_TYPES]))[0].n);
    const arWct = await ar(WCT);
    const arBc = await ar(BC);
    const counted = (d: Inv) => !['draft', 'unconfirmed', 'void'].includes(d.status) && d.config.voided !== true;
    const arRemoved = R2(removing.filter(counted).reduce((t, d) => t + d.owed, 0));
    const arMoved = R2(moving.filter(counted).reduce((t, d) => t + d.owed, 0));

    // Files: the records' own S3 objects (generated PDFs, attachments) and StoredFile rows.
    const { client: s3c, bucket } = s3();
    const s3Keys: string[] = [];
    for (const prefix of [`documents/${WCT}/`, `org/${WCT}/documents/`, ...ids.map((id) => `documents/${id}/`).slice(0, 0)]) {
      let token: string | undefined;
      do {
        const out: any = await s3c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of out.Contents || []) s3Keys.push(o.Key);
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
    }
    const attKeys = invs.flatMap((d) => JSON.stringify(d.config.attachments ?? []).match(/[\w\-./]+\.(pdf|png|jpe?g|webp|gif)/gi) ?? []);
    const fileOf = (d: Inv) => [...s3Keys.filter((k) => k.includes(d.id)), ...attKeys.filter((k) => k.includes(d.id))];
    const stored = await q(`select key, "organizationId" org from "StoredFile" where "organizationId" = $1`, [WCT]);
    const storedOf = (d: Inv) => stored.filter((s: any) => s.key.includes(d.id));

    // Full id sweep: nothing else may point at what is deleted (VOID journals, logs and the links handled here excepted).
    const delIds = removing.map((d) => d.id);
    const strays: string[] = [];
    if (delIds.length) {
      const cols = await q(
        `select table_name t, column_name col, udt_name u from information_schema.columns where table_schema = 'public' and (column_name ilike '%id' or column_name ilike '%ids')
           and (data_type in ('uuid','text','character varying') or udt_name in ('_text','_uuid')) and table_name not in ('ActionLog','AuditLog')`,
      );
      const allowed = new Set(['Document.id', 'JournalEntry.sourceDocumentId', 'DocumentEmbedding.documentId', 'Notification.entityId', 'DocumentShareLink.documentId', 'DocumentSignLink.documentId', 'Order.invoiceDocumentId']);
      for (const x of cols) {
        if (allowed.has(`${x.t}.${x.col}`)) continue;
        await c.query('SAVEPOINT sweep');
        const hit = await q(String(x.u).startsWith('_') ? `select count(*)::int n from "${x.t}" r where r."${x.col}"::text[] && $1::text[]` : `select count(*)::int n from "${x.t}" r where r."${x.col}"::text = any($1)`, [delIds]).catch(async (e: any) => {
          await c.query('ROLLBACK TO SAVEPOINT sweep');
          return [{ n: -1, e: e?.message }];
        });
        await c.query('RELEASE SAVEPOINT sweep');
        if (hit[0].n) strays.push(`${x.t}.${x.col}: ${hit[0].n === -1 ? 'sweep error ' + (hit[0] as any).e : hit[0].n + ' row(s)'}`);
      }
      // Orders keep JSON links only (handled above); a stray uuid column is a refusal.
    }

    // ── 3. REPORT ─────────────────────────────────────────────────────────
    const cls = (k: NgClass) => invs.filter((d) => d.cls === k);
    const sum = (xs: Inv[], k: 'gross' | 'owed' = 'gross') => R2(xs.reduce((t, d) => t + d[k], 0));
    const ph = cls('placeholder');
    say(`WCT (S) "(NG)" documents to BC Air: ${APPLY ? 'APPLY' : 'DRY RUN (read only, nothing written)'} · prod · ${new Date().toISOString()}`);
    say(`ERP links: ${links.size} invoices from ${lf.length} files (a later pull wins; ${linkChanges} changed)`);
    say(`Options: --zero ${ZERO}${INCLUDE_LINKED ? ' --include-linked' : ''}${BANK ? ' --bank ' + BANK : ' (no --bank)'}${KEEP_ABSS ? ' (ABSS balances kept)' : ' --no-keep-abss-balances'}${DETACH ? ' --detach-ledger' : ''}${ONLY_BATCH ? ' --batch ' + ONLY_BATCH : ''}`);
    say('\n== 1. FIND (WCT (S)) ==');
    say(`"(NG)" in the subject: ${invs.filter((d) => d.cls !== 'linked').length} invoices, S$${money(sum(invs.filter((d) => d.cls !== 'linked')))}`);
    say(`  $1 placeholders: ${ph.length}, S$${money(sum(ph))} (paid ${ph.filter((d) => d.owed < 0.005).length}, unpaid ${ph.filter((d) => d.owed >= 0.005).length} owing S$${money(sum(ph, 'owed'))}) · by total ${Object.entries(ph.reduce((m: any, d) => ((m[d.gross.toFixed(2)] = (m[d.gross.toFixed(2)] || 0) + 1), m), {})).map(([k, v]) => `$${k} x ${v}`).join(', ')}`);
    say(`    "(NG)" not at the start: ${ph.filter((d) => !/^\s*\(NG\)/i.test(d.subject)).map((d) => d.name).join(', ')}`);
    say(`    old-GST totals: ${ph.filter((d) => d.gross > 1.005).map((d) => `${d.name} $${d.gross.toFixed(2)}`).join(', ')}`);
    say(`  $0.00: ${cls('zero').length} (owing S$${money(sum(cls('zero'), 'owed'))})`);
    say(`  real (over $0, not a placeholder): ${cls('real').length}, S$${money(sum(cls('real')))}`);
    for (const d of cls('real')) say(`    ${d.name.padEnd(9)} S$${money(d.gross).padStart(10)} owed ${money(d.owed).padStart(9)}  ${d.date}  ${d.customerName}  | ${d.subject.slice(0, 70)}`);
    const over1 = invs.filter((d) => d.cls !== 'linked' && d.gross > 1.005);
    say(`  "(NG)" over $1.00 (the owner's "15"): ${over1.length}, S$${money(sum(over1))} = the ${cls('real').length} real + the 2 old-GST placeholders (I-008260 $1.08, I-002951 $1.07)`);
    say(`Linked to a BC Air quotation, no "(NG)" mark: ${cls('linked').length}, S$${money(sum(cls('linked')))} (${INCLUDE_LINKED ? 'MOVED (--include-linked)' : 'KEPT in WCT (S): WCT (S) issued them, owner 23 Nov; --include-linked moves them'})`);
    say(`Other "(NG)" document types in WCT (S): quotations 0 (all moved 12-23 Nov), credit notes 0 documents (ERP credit notes are journals: ${journals.filter((j) => j.type === 'CREDIT_NOTE').length} on these invoices), receipts ${receiptRefs.length}, payments ${payments.length}, transactions ${txns.length}, jobs ${jobs.length}, service reports ${srs.length}`);
    const ngElse = await q(
      `select 'order' t, count(*)::int n from "Order" where "organizationId" = $1 and ("linkedDocuments"::text ilike '%(NG)%' or coalesce(notes,'') ilike '%(NG)%')
       union all select 'job', count(*)::int from "Delivery" d where d."organizationId" = $1 and to_jsonb(d)::text ilike '%(NG)%'
       union all select 'service report', count(*)::int from "MaintenanceServiceReport" m where m."organizationId" = $1 and to_jsonb(m)::text ilike '%(NG)%'
       union all select 'other document', count(*)::int from "Document" where "organizationId" = $1 and not (upper(type::text) = any($2)) and config::text ilike '%(NG)%'`,
      [WCT, INVOICE_TYPES],
    );
    say(`Anything else in WCT (S) carrying "(NG)": ${ngElse.map((r: any) => `${r.t}s ${r.n}`).join(', ')}`);
    say(`ERP DOs in WCT (S) naming these invoices: ${wctDos.length} (all on WCT (S) quotations: they stay; the invoice number is ERP history text on a read-only DO)`);
    say(`On BC Air orders as cross-company pills: ${invs.filter((d) => pillsOf.has(d.id)).length} invoices on ${new Set(invs.flatMap((d) => (pillsOf.get(d.id) ?? []).map((o) => o.id))).size} orders · on WCT (S) orders: ${invs.filter((d) => wctOrderOf.has(d.id)).length}`);
    say(`Live journals on them: ${journals.length} (${Object.entries(journals.reduce((m: any, j) => ((m[`${String(j.createdBy).split(':')[0]} ${j.type}`] = (m[`${String(j.createdBy).split(':')[0]} ${j.type}`] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    say(`Embeddings ${embeds.length} · notifications ${notifs.length} · share links ${shareLinks.length} · sign links ${signLinks.length} · S3 files ${invs.reduce((t, d) => t + fileOf(d).length, 0)} · StoredFile rows ${invs.reduce((t, d) => t + storedOf(d).length, 0)}`);
    const bcNg = await q(`select type, count(*)::int n from "Document" where "organizationId" = $1 and (coalesce(config->>'subject','') ilike '%(NG)%' or coalesce(config->>'referenceNo','') ilike '%(NG)%') group by 1 order by 1`, [BC]);
    const bcOrdNg = bcOrders.filter((o) => o.sourceQuotationId && /\(NG\)/i.test(String(quoteById.get(o.sourceQuotationId)?.subject ?? ''))).length;
    say(`BC Air today: "(NG)" documents ${bcNg.map((r: any) => `${r.type} ${r.n}`).join(', ')} · orders on "(NG)" quotations ${bcOrdNg} of ${bcOrders.length} · orders with WCT (S) pills ${bcOrders.filter((o) => crossOrgInvoiceRefsOf(o).length).length} (${bcOrders.reduce((t, o) => t + crossOrgInvoiceRefsOf(o).length, 0)} pills; ${invs.filter((d) => pillsOf.has(d.id) && d.cls === 'placeholder').length} placeholders, ${invs.filter((d) => pillsOf.has(d.id) && d.cls === 'zero').length} $0, ${invs.filter((d) => pillsOf.has(d.id) && d.cls === 'real').length} real, ${invs.filter((d) => pillsOf.has(d.id) && d.cls === 'linked').length} linked)`);

    say('\n== 2. PLAN ==');
    const tally = (act: string) => {
      const xs = invs.filter((d) => d.action === act);
      const ok = xs.filter((d) => !d.holds.length);
      return `${ok.length} (S$${money(sum(ok))})${xs.length - ok.length ? `, held ${xs.length - ok.length}` : ''}`;
    };
    say(`REMOVE invoices: ${tally('remove')} · their journals VOIDED: ${voidJ.length}${detachJ.length ? ` · kept posted, detached: ${detachJ.length} (${detachJ.map((j) => j.journalNumber).join(', ')})` : ''} · BC Air pills removed: ${removing.reduce((t, d) => t + (pillsOf.get(d.id) ?? []).length, 0)} · WCT (S) order links removed: ${removing.reduce((t, d) => t + (wctOrderOf.get(d.id) ?? []).length, 0)} · embeddings ${embeds.filter((e) => removeIds.has(e.doc)).length}, notifications ${notifs.filter((n) => removeIds.has(n.doc)).length}, share / sign links ${[...shareLinks, ...signLinks].filter((n) => removeIds.has(n.doc)).length}, S3 files ${removing.reduce((t, d) => t + fileOf(d).length, 0)}`);
    say(`MOVE invoices to BC Air: ${tally('move')} · their journals moved: ${moveJ.length} · onto BC Air orders: ${moving.filter((d) => /^ORD/.test(landing.get(d.id) ?? '')).length} (new orders ${newOrders.filter((o) => orderPlans.get(o.id)?.add.length).length}) · no order ${moving.filter((d) => !/^ORD/.test(landing.get(d.id) ?? '')).length}`);
    const usedCust = new Set(moving.map((d) => d.config.customerId));
    const usedMap = [...custMap.entries()].filter(([k]) => usedCust.has(k)).map(([, v]) => v);
    const usedCreate = custCreate.filter((t) => usedCust.has(t.wctId));
    say(`  customers: ${usedMap.filter((x) => x.how !== 'create').length} mapped (UEN ${usedMap.filter((x) => x.how === 'UEN').length}, exact name ${usedMap.filter((x) => x.how === 'exact name').length}), ${usedCreate.length} to create in BC Air${usedCreate.length ? ': ' + usedCreate.map((x) => `${x.code} ${x.name} (${x.codeNote})`).join('; ') : ''}`);
    say(`KEEP in WCT (S): ${invs.filter((d) => d.action === 'keep').length} (linked, no "(NG)" mark)`);
    const held = invs.filter((d) => d.action !== 'keep' && d.holds.length);
    say(`HELD (cannot be moved / removed as planned, nothing written): ${held.length}`);
    for (const d of held) say(`  ${d.name} ${d.cls} S$${money(d.gross)}: ${d.holds.join('; ')}`);
    say('Account mapping WCT (S) -> BC Air (accounts on the moving journals):');
    for (const m of acctMap.values()) say(`  ${m.src.code} ${m.src.name} -> ${m.code ? `${m.code} ${bcByCode.get(m.code).name} (${m.how})` : `NOT MAPPED: ${m.why}`}`);
    const gstMoves = moving.filter((d) => Number(d.config.gstAmount) > 0.005);
    if (gstMoves.length) say(`  FLAG: GST charged on ${gstMoves.length} invoices moving to non-GST BC Air: ${gstMoves.map((d) => `${d.name} GST S$${money(Number(d.config.gstAmount))}`).join(', ')} (journal GST maps to BC Air 2-2100 GST Collected)`);

    say('\nBank side (moved payments received into a WCT (S) bank account):');
    const bankJ = moveJ.filter(({ j }) => (linesOf.get(j.id) ?? []).some((l) => mapOf(l.accountId).bank));
    say(`  ${bankJ.length} journal(s), S$${money(bankJ.reduce((t, { j }) => t + (linesOf.get(j.id) ?? []).filter((l) => mapOf(l.accountId).bank).reduce((s, l) => s + l.debit - l.credit, 0), 0))}: ${bankJ.map(({ j, d }) => `${j.journalNumber} (${d.name}, ${String(j.entryDate).slice(0, 10)})`).join(', ') || 'none'}`);
    say(`  A. Inter-company pair (recommended): the receipt moves to BC Air with its bank line on 1-3300 Other Rec - WCT (S) Systems (Dr) / Cr 1-9999 Trade Debtors; WCT (S) posts Dr its bank / Cr 1-3203 INTERB - BCA. WCT (S) bank unchanged, WCT (S) owes BC Air, BC Air's AR cleared against WCT (S).`);
    say(`  B. Keep the receipt in WCT (S): its journal stays (Dr bank / Cr 1-3100); WCT (S) posts Dr 1-3100 / Cr 1-3203 INTERB - BCA; BC Air posts Dr 1-3300 / Cr 1-9999. Same balances as A; the original ERP receipt stays untouched in WCT (S).`);
    say(`  C. As A, but BC Air's line goes to 1-2430 WCT (S) - OCBC Bank (WCT Cleaning) (the account BC Air's books already use for customer money banked by WCT (S): 16 payments, S$41,950.00).`);
    say(`  Not offered: moving the bank line into a BC Air bank (BC Air's bank would show money it never received). ${bankSide ? `CHOSEN: ${bankSide}` : 'Not chosen: apply refuses while a bank-side journal is in the move.'}`);

    say('\n== 3. DRY RUN: effect ==');
    say(`AR (owed on live invoices): WCT (S) S$${money(arWct)} -> S$${money(R2(arWct - arRemoved - arMoved))} (removed -${money(arRemoved)}, moved -${money(arMoved)}) · BC Air S$${money(arBc)} -> S$${money(R2(arBc + arMoved))}`);
    say('Ledger per account (posted balance = debit - credit; "pre-opening" = the part dated on or before the company\'s ABSS opening: WCT (S) 31 Dec 2023, BC Air 6 Nov 2026):');
    const eff = [...effect.values()].sort((a, b) => a.org.localeCompare(b.org) || a.code.localeCompare(b.code));
    const ledgerRows: any[] = [];
    for (const org of [WCT, BC]) {
      say(`  ${ORG_NAME[org]}:`);
      if (!eff.some((x) => x.org === org)) say('    no change (no journal moves into or out of it)');
      for (const e of eff.filter((x) => x.org === org)) {
        const after = R2((e.before ?? 0) + e.delta);
        const keep = rebalance.find((r) => r.org === org)?.lines.find((l: any) => l.code === e.code);
        const voidOnly = R2(after - (keep ? keep.debit - keep.credit : 0));
        say(`    ${e.code.padEnd(7)} ${e.name.slice(0, 34).padEnd(34)} ${money(e.before ?? 0).padStart(16)} -> ${money(after).padStart(16)}  (${e.delta >= 0 ? '+' : ''}${money(e.delta)})${KEEP_ABSS ? `   without the ABSS keep: ${money(voidOnly)}` : ''}  [pre-opening part ${money(e.prePlug)}]`);
        ledgerRows.push({ company: ORG_NAME[org], code: e.code, account: e.name, before: (e.before ?? 0).toFixed(2), change: e.delta.toFixed(2), after: after.toFixed(2), afterWithoutAbssKeep: voidOnly.toFixed(2), preOpening: e.prePlug.toFixed(2) });
      }
    }
    say(KEEP_ABSS
      ? `  Default (ABSS kept): one ADJUSTMENT per company at its ABSS opening date reverses the part dated on or before it, so every balance from that date on stays equal to ABSS / the bank (closed years' P&L to retained earnings). --no-keep-abss-balances leaves it out ("without the ABSS keep" column).`
      : `  --no-keep-abss-balances: the ABSS-matched balances move by the pre-opening parts above.`);
    for (const r of rebalance) say(`  ABSS keep journal: ${ORG_NAME[r.org]} ADJUSTMENT ${r.date}: ${r.lines.map((l: any) => `${l.code} ${l.debit ? 'Dr ' + money(l.debit) : 'Cr ' + money(l.credit)}`).join(', ')}`);
    for (const ij of intercoJournals) say(`  inter-company ${ORG_NAME[ij.org]} ${ij.number} ${String(ij.date).slice(0, 10)}: ${ij.lines.map((l: any) => `${l.account.code} ${l.debit ? 'Dr ' + money(l.debit) : 'Cr ' + money(l.credit)}`).join(', ')}`);

    const bcRows = statusRows.filter((r) => r.org === 'BC Air');
    const statusMoves: Record<string, number> = {};
    for (const r of statusRows) if (r.statusBefore !== r.statusAfter) statusMoves[`${r.org} ${r.statusBefore} -> ${r.statusAfter}`] = (statusMoves[`${r.org} ${r.statusBefore} -> ${r.statusAfter}`] || 0) + 1;
    say(`BC Air orders touched: ${bcRows.length} (new ${bcRows.filter((r) => r.created).length}) · Billed S$${money(bcRows.reduce((t, r) => t + (r.billedBefore ?? 0), 0))} -> S$${money(bcRows.reduce((t, r) => t + (r.billedAfter ?? 0), 0))} · Left to bill S$${money(bcRows.reduce((t, r) => t + (r.leftBefore ?? 0), 0))} -> S$${money(bcRows.reduce((t, r) => t + (r.leftAfter ?? 0), 0))} · over-billed after: ${bcRows.filter((r) => r.leftAfter != null && r.leftAfter < -0.01).length} (before ${bcRows.filter((r) => r.leftBefore != null && r.leftBefore < -0.01).length}) · invoices held for over-billing ${overHeld}`);
    say(`WCT (S) orders touched: ${statusRows.filter((r) => r.org === 'WCT (S)').length} · status changes: ${Object.entries(statusMoves).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
    say(`Orders that change Billed / Left to bill: ${statusRows.filter((r) => r.billedBefore !== r.billedAfter).length}`);

    const sampleLine = (d: Inv) => `${d.name} ${d.date} ${d.customerName} S$${money(d.gross)} owed ${money(d.owed)} · journals ${(journalsOf.get(d.id) ?? []).map((j) => j.journalNumber).join(' ') || 'none'} · ${pillsOf.has(d.id) ? 'pill on ' + pillsOf.get(d.id)!.map((o) => o.orderNumber).join(' ') : wctOrderOf.has(d.id) ? 'on WCT (S) ' + wctOrderOf.get(d.id)!.map((o) => o.orderNumber).join(' ') : 'no order'}${d.action === 'move' ? ` -> ${landing.get(d.id) ?? 'held'}, customer ${custMap.get(d.config.customerId)?.code ?? '?'} ${custMap.get(d.config.customerId)?.name ?? ''} (${custMap.get(d.config.customerId)?.how ?? ''})` : ''}`;
    say('\nSamples, REMOVE (10):');
    for (const d of sample(removing)) say(`  ${sampleLine(d)}`);
    say('Samples, MOVE (10):');
    for (const d of sample(moving)) say(`  ${sampleLine(d)}`);
    const changed = statusRows.filter((r) => r.statusBefore !== r.statusAfter || r.billedBefore !== r.billedAfter);
    say(`Samples, orders whose status or Billed changes (10 of ${changed.length}; all in orders.csv):`);
    for (const r of sample(changed)) say(`  ${r.org} ${r.order}${r.created ? ' (new)' : ''} +[${r.added}] -[${r.dropped}] · ${r.statusBefore} -> ${r.statusAfter} · billed ${r.billedBefore ?? '-'} -> ${r.billedAfter ?? '-'} of ${r.quoteTotal ?? '-'} · left ${r.leftBefore ?? '-'} -> ${r.leftAfter ?? '-'}`);
    if (strays.length) say(`\nREFUSE (other rows point at documents to be removed):\n  ${strays.join('\n  ')}`);
    else say('\nFull id sweep: no other row points at the documents to be removed.');

    // CSVs
    const invCols = ['name', 'date', 'customerName', 'subject', 'gross', 'owed', 'status', 'cls', 'action', 'held', 'linkedQuote', 'pills', 'wctOrders', 'landing', 'journals', 'bcCustomer'];
    const invRow = (d: Inv) => ({ ...d, held: d.holds.join('; '), pills: (pillsOf.get(d.id) ?? []).map((o) => o.orderNumber).join(' '), wctOrders: (wctOrderOf.get(d.id) ?? []).map((o) => o.orderNumber).join(' '), landing: landing.get(d.id) ?? '', journals: (journalsOf.get(d.id) ?? []).map((j) => j.journalNumber).join(' '), bcCustomer: custMap.get(d.config.customerId) ? `${custMap.get(d.config.customerId)!.code} ${custMap.get(d.config.customerId)!.name} (${custMap.get(d.config.customerId)!.how})` : '' });
    writeCsv(path.join(CSV_DIR, 'placeholders-remove.csv'), invCols, ph.map(invRow));
    writeCsv(path.join(CSV_DIR, 'zero.csv'), invCols, cls('zero').map(invRow));
    writeCsv(path.join(CSV_DIR, 'real.csv'), invCols, cls('real').map(invRow));
    writeCsv(path.join(CSV_DIR, 'linked-no-ng-mark.csv'), invCols, cls('linked').map(invRow));
    writeCsv(path.join(CSV_DIR, 'held.csv'), invCols, held.map(invRow));
    writeCsv(path.join(CSV_DIR, 'ledger.csv'), ['company', 'code', 'account', 'before', 'change', 'after', 'afterWithoutAbssKeep', 'preOpening'], ledgerRows);
    writeCsv(path.join(CSV_DIR, 'orders.csv'), ['org', 'order', 'created', 'imported', 'added', 'dropped', 'statusBefore', 'statusAfter', 'billedBefore', 'billedAfter', 'quoteTotal', 'leftBefore', 'leftAfter', 'held'], statusRows);
    writeCsv(path.join(CSV_DIR, 'journals.csv'), ['journalNumber', 'type', 'entryDate', 'createdBy', 'invoice', 'action', 'lines'], [
      ...voidJ.map((j) => ({ ...j, invoice: byId.get(j.docId)?.name, action: 'VOID', lines: (linesOf.get(j.id) ?? []).map((l) => `${acctById.get(l.accountId).code} ${l.debit ? 'Dr ' + l.debit : 'Cr ' + l.credit}`).join(' | ') })),
      ...moveJ.map(({ j, d }) => ({ ...j, invoice: d.name, action: 'MOVE', lines: (linesOf.get(j.id) ?? []).map((l) => `${acctById.get(l.accountId).code}->${mapOf(l.accountId).code ?? '?'} ${l.debit ? 'Dr ' + l.debit : 'Cr ' + l.credit}`).join(' | ') })),
    ]);
    writeCsv(path.join(CSV_DIR, 'wct-dos-naming-ng-invoices.csv'), ['name', 'quote', 'orderNo', 'invs'], wctDos.map((x: any) => ({ ...x, invs: (x.invs || []).join(' ') })));
    writeCsv(path.join(CSV_DIR, 'customers-to-create.csv'), ['code', 'name', 'codeNote', 'email', 'uen'], custCreate.filter((t) => moving.some((d) => d.config.customerId === t.wctId)));

    // ── 4. APPLY ──────────────────────────────────────────────────────────
    if (!APPLY) {
      await c.query('ROLLBACK');
      say(`\nDry run: nothing written, nothing deleted. Report ${path.join(OUT_DIR, STEM + '.txt')}, CSVs ${CSV_DIR}`);
      fs.writeFileSync(path.join(OUT_DIR, STEM + '.txt'), L.join('\n') + '\n');
      await c.end();
      return;
    }
    if (strays.length) throw new Error('Refusing: other rows point at documents to be removed');
    if (bankJ.length && !bankSide) throw new Error('Refusing: a moving journal was received into a WCT (S) bank; pass --bank A|B|C');
    if ((bankSide === 'A' || bankSide === 'C' || bankSide === 'B') && bankJ.length && !(intercoWct && intercoBc && bcDebtors && wctDebtors)) throw new Error('Refusing: inter-company accounts missing');
    const now = new Date().toISOString();
    const log: any = { at: now, script: SCRIPT, options: { ZERO, INCLUDE_LINKED, BANK, KEEP_ABSS, ONLY_BATCH }, removed: [], voided: [], moved: [], movedJournals: [], customers: [], orders: [], newOrders: [], journalsCreated: [], s3: [], actionLogs: [] };
    const alog = async (org: string, action: string, resource: string, resourceId: string, note: string, extra: any = {}) => {
      const id = randomUUID();
      await c.query(
        `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt") values ($1,'SYSTEM',$2,'System creation',$3,'operator',$4,$5,$6,$7::jsonb,'SUCCESS',now())`,
        [id, SCRIPT, org, action, resource, resourceId, JSON.stringify({ note, ...extra })],
      );
      log.actionLogs.push(id);
    };
    // Customers.
    for (const t of custCreate.filter((t) => moving.some((d) => d.config.customerId === t.wctId))) {
      await c.query(`insert into "Customer" (id, "customerCode", name, email, phone, address, "gstRegNo", uen, "externalRef", currency, "organizationId", "createdAt", "updatedAt") values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())`, [t.id, t.code, t.name, t.email, t.phone, t.address, t.gstRegNo, t.uen, t.externalRef, t.currency, BC]);
      await alog(BC, 'CREATE', 'customer', t.id, `Customer ${t.code} ${t.name} created for invoices moved from WCT (S) ("(NG)" documents to BC Air)`);
      log.customers.push(t);
    }
    // Removals: void journals, then delete the documents and what hangs off them.
    for (const d of removing) {
      const js = (journalsOf.get(d.id) ?? []).filter((j) => !detachIds.has(j.id));
      for (const j of (journalsOf.get(d.id) ?? []).filter((x) => detachIds.has(x.id))) {
        await c.query(`update "JournalEntry" set "sourceDocumentId" = null, "updatedAt" = now() where id = $1 and "sourceDocumentId" = $2`, [j.id, d.id]);
        log.detached = [...(log.detached || []), { id: j.id, journalNumber: j.journalNumber, sourceDocumentId: d.id }];
      }
      for (const j of js) {
        await c.query(`update "JournalEntry" set status = 'VOID', "voidedAt" = now(), "voidedBy" = $2, "updatedAt" = now() where id = $1 and status <> 'VOID'`, [j.id, SCRIPT]);
        log.voided.push({ id: j.id, journalNumber: j.journalNumber, status: j.status });
      }
      const full = (await q(`select * from "Document" where id = $1::uuid`, [d.id]))[0];
      await c.query(`delete from "DocumentEmbedding" where "documentId" = $1::uuid`, [d.id]);
      await c.query(`delete from "Notification" where "entityId" = $1`, [d.id]);
      await c.query(`delete from "DocumentShareLink" where "documentId"::text = $1`, [d.id]).catch(() => undefined);
      await c.query(`delete from "DocumentSignLink" where "documentId"::text = $1`, [d.id]).catch(() => undefined);
      for (const s of storedOf(d)) await c.query(`delete from "StoredFile" where key = $1`, [s.key]);
      const del = await c.query(`delete from "Document" where id = $1::uuid and "organizationId" = $2`, [d.id, WCT]);
      if (del.rowCount !== 1) throw new Error(`delete ${d.name}: ${del.rowCount} rows`);
      await alog(WCT, 'DELETE', 'document', d.id, `"(NG)" $1 placeholder invoice ${d.name} (S$${money(d.gross)}) removed; ${js.length} journal(s) voided (${js.map((j) => j.journalNumber).join(', ')}); owner + finance 25 Nov`, { voided: js.map((j) => j.journalNumber) });
      log.removed.push({ row: full, journals: js.map((j) => j.id), files: fileOf(d), stored: storedOf(d) });
    }
    // Moves.
    const bcOrg = orgOf.get(BC);
    for (const d of moving) {
      const m = custMap.get(d.config.customerId)!;
      const full = (await q(`select config, "documentTemplateId", "listCustomerId" from "Document" where id = $1::uuid`, [d.id]))[0];
      const patch: any = {
        customerId: m.id,
        customerName: m.name,
        customerCode: m.code ?? '',
        company: { ...(full.config.company || {}), name: bcOrg.name, address: bcOrg.address ?? '', phoneNumber: bcOrg.phoneNumber ?? '' },
        gstRegNo: bcOrg.registrationNumber ?? '',
        movedFrom: { organizationId: WCT, orgName: 'WCT (S)', number: d.name, wctCustomerId: d.config.customerId ?? null, wctTemplateId: d.templateId, at: now, by: 'script', reason: '"(NG)" documents to BC Air (owner + finance 25 Nov)' },
      };
      if (full.config.customer && typeof full.config.customer === 'object') patch.customer = { ...full.config.customer, id: m.id, name: m.name, customerCode: m.code ?? full.config.customer.customerCode };
      const up = await c.query(`update "Document" set "organizationId" = $2, "documentTemplateId" = $3, "listCustomerId" = $4, config = config || $5::jsonb, "updatedAt" = now() where id = $1::uuid and "organizationId" = $6`, [d.id, BC, bcTpl, m.id, JSON.stringify(patch), WCT]);
      if (up.rowCount !== 1) throw new Error(`move ${d.name}: ${up.rowCount} rows`);
      await c.query(`update "DocumentEmbedding" set "organizationId" = $2, "customerId" = $3 where "documentId" = $1::uuid`, [d.id, BC, m.id]);
      await c.query(`update "Notification" set "organizationId" = $2 where "entityId" = $1`, [d.id, BC]).catch(() => undefined);
      for (const s of storedOf(d)) await c.query(`update "StoredFile" set "organizationId" = $2 where key = $1`, [s.key, BC]);
      const js = journalsOf.get(d.id) ?? [];
      for (const j of js) {
        const ls = linesOf.get(j.id) ?? [];
        const bankLines = ls.filter((l) => mapOf(l.accountId).bank);
        if (bankLines.length && bankSide === 'B') {
          log.movedJournals.push({ id: j.id, kept: true });
          continue; // the receipt stays in WCT (S); the transfer journals below carry it across
        }
        for (const l of ls) {
          const mp = mapOf(l.accountId);
          const to = mp.code ? bcByCode.get(mp.code) : intercoBc;
          await c.query(`update "JournalEntryLine" set "accountId" = $2, "costCenterId" = null where id = $1`, [l.id, to.id]);
        }
        await c.query(`update "JournalEntry" set "organizationId" = $2, "updatedAt" = now() where id = $1 and "organizationId" = $3`, [j.id, BC, WCT]);
        log.movedJournals.push({ id: j.id, journalNumber: j.journalNumber, lines: ls.map((l) => ({ id: l.id, accountId: l.accountId, costCenterId: l.costCenterId })) });
      }
      const note = `Moved from WCT (S): invoice ${d.name} (S$${money(d.gross)}, owed S$${money(d.owed)}) to BC Air${landing.get(d.id) ? ', ' + landing.get(d.id) : ''}; customer ${m.code ?? ''} ${m.name}; ${js.length} journal(s) moved; number kept`;
      await alog(BC, 'MOVE', 'document', d.id, note, { from: WCT });
      await alog(WCT, 'MOVE', 'document', d.id, `Moved to BC Air: invoice ${d.name} ("(NG)" documents to BC Air, owner + finance 25 Nov)`, { to: BC });
      log.moved.push({ id: d.id, name: d.name, before: full });
    }
    // Inter-company and rebalancing journals.
    const jNo = async (org: string, base: string) => {
      let n = base, i = 1;
      while ((await q(`select 1 from "JournalEntry" where "organizationId" = $1 and "journalNumber" = $2`, [org, n])).length) n = `${base}-${++i}`;
      return n;
    };
    const postJournal = async (org: string, number: string, date: string, type: string, reference: string | null, description: string, lines: Array<{ accountId: string; debit: number; credit: number }>) => {
      const id = randomUUID();
      const tot = R2(lines.reduce((t, l) => t + l.debit, 0));
      if (Math.abs(tot - R2(lines.reduce((t, l) => t + l.credit, 0))) > 0.005) throw new Error(`unbalanced ${number}`);
      await c.query(`insert into "JournalEntry"(id, "organizationId", "journalNumber", "entryDate", type, status, reference, description, "totalDebit", "totalCredit", currency, "postedAt", "postedBy", "createdAt", "updatedAt", "createdBy") values ($1,$2,$3,$4::timestamp,$5,'POSTED',$6,$7,$8,$8,'SGD',now(),$9,now(),now(),$9)`, [id, org, await jNo(org, number), String(date).slice(0, 10) + 'T00:00:00.000Z', type, reference, description, tot, SCRIPT]);
      let n = 1;
      for (const l of lines) await c.query(`insert into "JournalEntryLine"(id, "journalEntryId", "accountId", "lineNumber", description, debit, credit) values ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), id, l.accountId, n++, description, l.debit, l.credit]);
      log.journalsCreated.push(id);
      await alog(org, 'CREATE', 'journal', id, `${description} (${number})`);
    };
    for (const ij of intercoJournals) await postJournal(ij.org, ij.number, ij.date, 'ADJUSTMENT', ij.ref, `Inter-company: ${ij.d.name} moved to BC Air, money banked by WCT (S) (bank side ${bankSide})`, ij.lines.map((l: any) => ({ accountId: l.account.id, debit: R2(l.debit), credit: R2(l.credit) })));
    if (bankSide === 'A' || bankSide === 'C') {
      // A / C: the moved receipt's bank line now sits on the inter-company account in BC Air (done in the line remap above).
    }
    for (const r of rebalance) await postJournal(r.org, `NG-ABSS-KEEP-${r.date}`, r.date, 'ADJUSTMENT', 'wct-ng-bcair', `Keeps ABSS balances after the "(NG)" move / removal (part dated on or before ${r.date})`, r.lines.map((l: any) => ({ accountId: (r.org === WCT ? wctByCode : bcByCode).get(l.code).id, debit: l.debit, credit: l.credit })));
    // Orders.
    for (const p of orderPlans.values()) {
      if (p.create) {
        if (!p.add.length) continue;
        const created = p.order.date && /^\d{4}-\d{2}-\d{2}$/.test(p.order.date) ? `${p.order.date}T01:00:00.000Z` : now;
        await c.query(`insert into "Order"(id, "orderNumber", "organizationId", "customerId", "sourceQuotationId", status, items, "linkedDocuments", notes, "createdAt", "updatedAt") values ($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,'[]'::jsonb,$7::jsonb,$8,$9::timestamp,now())`, [p.order.id, p.order.orderNumber, BC, p.order.customerId, p.order.sourceQuotationId, statusRows.find((r) => r.orderId === p.order.id)?.statusAfter ?? 'INVOICED', JSON.stringify(p.ld), `Imported from the old ERP: quotation ${p.order.linkedDocuments.imported.quotationNo}`, created]);
        await alog(BC, 'CREATE', 'order', p.order.id, `Order ${p.order.orderNumber} made for invoices moved from WCT (S): ${p.add.map((d) => d.name).join(', ')}`);
        log.newOrders.push(p.order.id);
        continue;
      }
      if (!p.add.length && !p.drop.length) continue;
      const st = statusRows.find((r) => r.orderId === p.order.id)?.statusAfter ?? p.order.status;
      await c.query(`update "Order" set "linkedDocuments" = $2::jsonb, status = $3, "invoiceDocumentId" = case when "invoiceDocumentId"::text = any($5) then null else "invoiceDocumentId" end, "updatedAt" = now() where id = $1::uuid and "organizationId" = $4`, [p.order.id, JSON.stringify(p.ld), st, p.org, p.drop.map((d) => d.id)]);
      await alog(p.org, 'UPDATE', 'order', p.order.id, `${p.order.orderNumber}: ${p.add.length ? `invoices moved from WCT (S) added ${p.add.map((d) => d.name).join(', ')}; ` : ''}${p.drop.length ? `WCT (S) invoice links removed ${p.drop.map((d) => d.name).join(', ')}; ` : ''}status ${p.order.status} -> ${st}`);
      log.orders.push({ id: p.order.id, org: p.org, linkedDocuments: p.order.linkedDocuments, status: p.order.status, invoiceDocumentId: p.order.invoiceDocumentId ?? null });
    }
    // Guards / checks before commit.
    const live = await q(`select count(*)::int n from "JournalEntry" where "sourceDocumentId" = any($1) and status <> 'VOID'`, [delIds]);
    if (live[0].n) throw new Error('live journal left on a removed document');
    const logFile = path.join(OUT_DIR, `${STEM}.log.json`);
    fs.writeFileSync(logFile, JSON.stringify(log));
    await c.query('COMMIT');
    committed = true;
    say(`\nAPPLIED: removed ${log.removed.length}, voided ${log.voided.length} journals, moved ${log.moved.length} invoices + ${log.movedJournals.length} journals, ${log.customers.length} customers, ${log.newOrders.length} new orders, ${log.orders.length} orders updated, ${log.journalsCreated.length} journals posted. Log ${logFile}`);
    // S3 after commit: copy each removed record's own file into the log folder, then delete it.
    const s3Dir = path.join(OUT_DIR, `${STEM}-s3`);
    for (const r of log.removed) {
      for (const k of r.files) {
        try {
          const obj: any = await s3c.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
          const buf = Buffer.from(await obj.Body.transformToByteArray());
          fs.mkdirSync(path.dirname(path.join(s3Dir, k)), { recursive: true });
          fs.writeFileSync(path.join(s3Dir, k), buf);
          await s3c.send(new DeleteObjectCommand({ Bucket: bucket, Key: k }));
          log.s3.push(k);
        } catch (e: any) {
          say(`  S3 ${k}: ${e?.message}`);
        }
      }
    }
    fs.writeFileSync(logFile, JSON.stringify(log));
    say(`S3: ${log.s3.length} file(s) saved to ${s3Dir} and deleted.`);
    fs.writeFileSync(path.join(OUT_DIR, STEM + '.txt'), L.join('\n') + '\n');
  } catch (e) {
    if (!committed) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end().catch(() => undefined);
  }
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

/** Undo an APPLY from its log (same transaction rules; S3 files re-uploaded from the log folder). */
async function rollback(c: Client, q: (sql: string, p?: unknown[]) => Promise<any[]>, say: (s?: string) => void) {
  const log = JSON.parse(fs.readFileSync(ROLLBACK!, 'utf8'));
  say(`ROLLBACK ${APPLY ? 'APPLY' : 'DRY RUN'} of ${ROLLBACK}: ${log.removed.length} removed, ${log.voided.length} voided, ${log.moved.length} moved, ${log.newOrders.length} new orders, ${log.journalsCreated.length} posted journals`);
  if (!APPLY) { await c.end(); return; }
  await c.query('BEGIN');
  try {
    for (const id of log.journalsCreated) { await c.query(`delete from "JournalEntryLine" where "journalEntryId" = $1`, [id]); await c.query(`delete from "JournalEntry" where id = $1`, [id]); }
    for (const o of log.orders) await c.query(`update "Order" set "linkedDocuments" = $2::jsonb, status = $3, "invoiceDocumentId" = $4::uuid, "updatedAt" = now() where id = $1::uuid`, [o.id, JSON.stringify(o.linkedDocuments), o.status, o.invoiceDocumentId]);
    for (const id of log.newOrders) await c.query(`delete from "Order" where id = $1::uuid`, [id]);
    for (const j of log.movedJournals) {
      if (j.kept) continue;
      for (const l of j.lines) await c.query(`update "JournalEntryLine" set "accountId" = $2, "costCenterId" = $3 where id = $1`, [l.id, l.accountId, l.costCenterId]);
      await c.query(`update "JournalEntry" set "organizationId" = $2, "updatedAt" = now() where id = $1`, [j.id, WCT]);
    }
    for (const m of log.moved) {
      await c.query(`update "Document" set "organizationId" = $2, "documentTemplateId" = $3, "listCustomerId" = $4, config = $5::jsonb, "updatedAt" = now() where id = $1::uuid`, [m.id, WCT, m.before.documentTemplateId, m.before.listCustomerId, JSON.stringify(m.before.config)]);
      await c.query(`update "DocumentEmbedding" set "organizationId" = $2 where "documentId" = $1::uuid`, [m.id, WCT]);
    }
    for (const t of log.customers) await c.query(`delete from "Customer" where id = $1::uuid and "organizationId" = $2`, [t.id, BC]);
    for (const r of log.removed) {
      const d = r.row;
      await c.query(`insert into "Document"(id, "createdAt", "updatedAt", config, "documentTemplateId", type, "organizationId", name, "listIssueDate", "listSearch", "listCustomerId", status, "baseDocumentId", "revisionNumber", version, attachments) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12::"DocumentStatus",$13,$14,$15,$16::jsonb)`, [d.id, d.createdAt, d.updatedAt, JSON.stringify(d.config), d.documentTemplateId, d.type, d.organizationId, d.name, d.listIssueDate, d.listSearch, d.listCustomerId, d.status, d.baseDocumentId, d.revisionNumber, d.version, d.attachments == null ? null : JSON.stringify(d.attachments)]);
    }
    for (const j of log.detached || []) await c.query(`update "JournalEntry" set "sourceDocumentId" = $2, "updatedAt" = now() where id = $1 and "sourceDocumentId" is null`, [j.id, j.sourceDocumentId]);
    for (const j of log.voided) await c.query(`update "JournalEntry" set status = $2, "voidedAt" = null, "voidedBy" = null, "updatedAt" = now() where id = $1 and "voidedBy" = $3`, [j.id, j.status, SCRIPT]);
    await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status) values (gen_random_uuid(),'SYSTEM',$1,'System creation',$2,'operator','UPDATE','document',$3::jsonb,'SUCCESS')`, [SCRIPT, WCT, JSON.stringify({ note: `Rolled back "(NG)" move / removal ${ROLLBACK}` })]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  const { client: s3c, bucket } = s3();
  const s3Dir = ROLLBACK!.replace(/\.log\.json$/, '-s3');
  for (const k of log.s3) await s3c.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: fs.readFileSync(path.join(s3Dir, k)) }));
  say(`Rolled back. S3 restored ${log.s3.length}.`);
  await c.end();
}
