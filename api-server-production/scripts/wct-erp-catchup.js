/**
 * WCT old-ERP catch-up (2026-11-19). Brings AIMS up to date with the old ERP (wct.iserviceshub.com)
 * until it is switched off. DRY RUN BY DEFAULT; read-only database session.
 *
 * 1. Pull (browser, read-only GETs): load scripts/wct-erp-catchup/erp-pull.browser.js in a logged-in
 *    ERP tab and run the call this script prints with --print-pull. Part CSVs land in ~/Downloads as
 *    erp-catchup-part-NN.csv.
 * 2. This script merges the parts into _imports/wct/erp-catchup/<date>/ (original export columns:
 *    wct-quotes-full.csv, wct-invoices-full.csv, wct-quote-lines.csv, wct-invoice-lines.csv, plus the
 *    three ERP lists) and deletes the parts. Then, read-only against the database:
 *      - the highest imported numbers / ERP ids per org, and the gap by month
 *      - NEW documents: what wct-erp-import.js would insert (same fields, config.erpImport, GL guard),
 *        "(NG)" quotations flagged for BC Air (moved by wct-ng-quotes-to-bcair.ts, as before)
 *      - REFRESH of imported documents still open at import: invoices (status / balance / credit notes),
 *        quotations (status). Only erpImport.status and the money keys change, never content.
 *      - native AIMS quotations / invoices since cutover that look like a new ERP document (list only)
 *      - the imported-orders top-up dry run with the planned documents (wct-imported-orders.ts --extra-docs)
 *    Report: <out>/catchup-dryrun.txt (+ CSVs), plan: <out>/plan.json.
 *
 *   node scripts/wct-erp-catchup.js --env prod --print-pull          the browser call (thresholds from AIMS)
 *   node scripts/wct-erp-catchup.js --env prod                       merge ~/Downloads parts + dry run
 *   node scripts/wct-erp-catchup.js --env prod --from <out dir>      dry run again on an earlier pull
 * Apply (only with Elroy's APPLY): see the "APPLY steps" printed at the end of the report.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ORG = { WCT: '5c700000-0000-4000-8000-5c7000000001', RACKING: '5c700000-0000-4000-8000-5c7000000002', BCAIR: '5c700000-0000-4000-8000-5c7000000004' };
const ORG_NAME = { [ORG.WCT]: 'WCT (S)', [ORG.RACKING]: 'Racking', [ORG.BCAIR]: 'BC Air' };
const argv = process.argv.slice(2);
const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev');
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const REPO = path.resolve(__dirname, '../..');
const IMPORTS = path.join(os.homedir(), 'Desktop/aims/_imports/wct');
const OUT = one('--from') || one('--out', path.join(IMPORTS, 'erp-catchup', TODAY));
const PARTS = one('--parts-dir', path.join(os.homedir(), 'Downloads'));
const QUOTE_SCOPE = new Set(['Accepted', 'Declined', 'Sent']); // same scope as the first import
const INVOICE_SCOPE = new Set(['Paid', 'Overdue', 'Receivable', 'Partial']);
const OPEN_INVOICE = new Set(['Overdue', 'Receivable', 'Partial']);
const R2 = (n) => Math.round(n * 100) / 100;
const num = (s) => { const n = Number(String(s ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const n1 = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/’/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const normSubject = (s) => String(s ?? '').replace(/\(NG\)/gi, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(pteltd|privatelimited|ltd|llp)$/, '');

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
const toObjects = (rows) => { const [h, ...b] = rows; return b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))); };
const readCsv = (file) => toObjects(parseCsv(fs.readFileSync(file, 'utf8')));
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file, cols, rows) => fs.writeFileSync(file, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');

const Q_COLS = ['erp_id', 'erp_revision_id', 'quotation_no', 'revision', 'date', 'status', 'department', 'reference_no', 'customer', 'client_site', 'billing_address', 'job_location', 'attention', 'attention_title', 'attention_mobile', 'attention_email', 'attention_tel', 'contract_no', 'service_order', 'sales_person', 'sales_email', 'sales_phone', 'coordinator', 'subject', 'sub_heading', 'subtotal', 'discount', 'gst_rate', 'gst_amount', 'total', 'list_total', 'line_count', 'notes', 'terms'];
const I_COLS = ['erp_id', 'erp_revision_id', 'invoice_no', 'revision', 'date', 'status', 'payment_term', 'department', 'reference_no', 'po_number', 'our_do_no', 'your_ref', 'customer', 'client_site', 'billing_address', 'job_location', 'attention', 'attention_title', 'attention_mobile', 'attention_email', 'attention_tel', 'contract_no', 'service_order', 'sales_person', 'sales_email', 'sales_phone', 'coordinator', 'subject', 'sub_heading', 'subtotal', 'discount', 'gst_rate', 'gst_amount', 'total', 'balance_due', 'credit_note', 'line_count', 'notes', 'terms'];
const L_COLS = ['erp_id', 'doc_no', 'line_no', 'description', 'qty', 'unit_price', 'discount', 'amount'];

/** Merge ~/Downloads/erp-catchup-part-NN.csv into OUT (original export columns), then delete the parts. */
function mergeParts() {
  const parts = fs.existsSync(PARTS) ? fs.readdirSync(PARTS).filter((f) => /^erp-catchup-part-\d+( \(\d+\))?\.csv$/.test(f)).sort() : [];
  if (!parts.length) return false;
  const lists = { quotation: [], invoice: [], credit_note: [] };
  const det = [], lines = [];
  for (const f of parts) {
    const rows = toObjects(parseCsv(fs.readFileSync(path.join(PARTS, f), 'utf8')));
    for (const r of rows) {
      if (r.list) lists[r.list.split(':')[0]].push(r);
      else if (r.detail_kind) det.push(r);
      else if (r.kind) lines.push(r);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  // A second pull on the same day adds to the folder: a document pulled again replaces its rows.
  const prior = (f) => (fs.existsSync(path.join(OUT, f)) ? readCsv(path.join(OUT, f)) : []);
  const keep = (old, fresh, key) => { const k = new Set(fresh.map(key)); return [...old.filter((r) => !k.has(key(r))), ...fresh]; };
  lists.quotation = keep(prior('erp-quotation-list.csv'), lists.quotation, (r) => `${r.list}|${r.erp_id}`);
  lists.invoice = keep(prior('erp-invoice-list.csv'), lists.invoice, (r) => `${r.list}|${r.erp_id}`);
  if (!lists.credit_note.length) lists.credit_note = prior('erp-credit-note-list.csv');
  const freshIds = new Set(det.map((r) => `${r.detail_kind}|${r.erp_id}`));
  det.unshift(...[...prior('wct-quotes-full.csv').map((r) => ({ detail_kind: 'quotation', ...r })), ...prior('wct-invoices-full.csv').map((r) => ({ detail_kind: 'invoice', ...r }))].filter((r) => !freshIds.has(`${r.detail_kind}|${r.erp_id}`)));
  lines.unshift(...[...prior('wct-quote-lines.csv').map((l) => ({ kind: 'quotation', ...l })), ...prior('wct-invoice-lines.csv').map((l) => ({ kind: 'invoice', ...l }))].filter((l) => !freshIds.has(`${l.kind}|${l.erp_id}`)));
  writeCsv(path.join(OUT, 'erp-quotation-list.csv'), ['list', 'erp_id', 'erp_revision_id', 'quotation_no', 'customer', 'client_site', 'subject', 'date', 'total', 'status'], lists.quotation);
  writeCsv(path.join(OUT, 'erp-invoice-list.csv'), ['list', 'erp_id', 'erp_revision_id', 'invoice_no', 'customer', 'client_site', 'subject', 'date', 'total', 'status'], lists.invoice);
  writeCsv(path.join(OUT, 'erp-credit-note-list.csv'), ['erp_id', 'credit_note_no', 'customer', 'date', 'invoice_no', 'invoice_status', 'total', 'refund_receipt', 'status'], lists.credit_note);
  // Clean-ups so the rows read like the first export: an empty attention select reads "--Select--", a
  // contact without a number ends in " -"; the quotation page fills its GST in by script (the raw field is
  // "---" / 0.00), so a quotation's GST is the ERP total minus the lines after discount, rate rounded.
  for (const r of det) {
    if (/^-+\s*select/i.test(r.attention)) r.attention = '';
    r.attention = r.attention.replace(/\s+-$/, '').trim();
    if (r.detail_kind === 'quotation') {
      const base = R2(num(r.subtotal) - num(r.discount));
      const gst = R2(num(r.total) - base);
      if (Math.abs(gst) > 0.005 && num(r.gst_amount) === 0) { r.gst_amount = gst.toFixed(2); r.gst_rate = base ? String(Math.round((gst / base) * 100)) : '---'; }
    }
  }
  const dq = det.filter((r) => r.detail_kind === 'quotation');
  const di = det.filter((r) => r.detail_kind === 'invoice');
  writeCsv(path.join(OUT, 'wct-quotes-full.csv'), Q_COLS, dq);
  writeCsv(path.join(OUT, 'wct-invoices-full.csv'), [...I_COLS, 'erp_quotation_no', 'erp_quotation_id', 'amount_paid'], di);
  writeCsv(path.join(OUT, 'wct-quote-lines.csv'), L_COLS, lines.filter((l) => l.kind === 'quotation'));
  writeCsv(path.join(OUT, 'wct-invoice-lines.csv'), L_COLS, lines.filter((l) => l.kind === 'invoice'));
  for (const f of parts) fs.unlinkSync(path.join(PARTS, f));
  console.log(`merged ${parts.length} part files into ${OUT} (lists: ${lists.quotation.length} quotations, ${lists.invoice.length} invoices, ${lists.credit_note.length} credit notes; details: ${dq.length} quotations, ${di.length} invoices, ${lines.length} lines); parts deleted`);
  return true;
}

(async () => {
  if (!['dev', 'prod'].includes(ENV)) throw new Error('--env dev|prod');
  if (argv.includes('--apply')) throw new Error('this script only plans; the APPLY steps are listed in the report');
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;

  const docs = await q(
    `select d.id::text id, d."organizationId"::text org, d.type, d.name, d.status::text status, d."createdAt",
            d.config->'erpImport' erp, d.config->>'customerId' "customerId", d.config->>'customerName' "customerName",
            d.config->>'subject' subject, d.config->>'date' date, (d.config->>'totalWithTax')::numeric total,
            (d.config->>'outstandingBalance') outstanding, (d.config->>'paidToDate') paid
       from "Document" d where d."organizationId" = any($1) and d.type in ('QUOTATION','INVOICE','CREDIT_NOTE')`,
    [Object.values(ORG)],
  );
  const wctErp = docs.filter((d) => d.erp?.source === 'wct-erp');
  const maxId = (type) => Math.max(0, ...wctErp.filter((d) => d.type === type && /^\d+$/.test(d.erp.erpId)).map((d) => Number(d.erp.erpId)));
  const lastQuoteId = maxId('QUOTATION');
  const lastInvoiceId = maxId('INVOICE');
  if (argv.includes('--print-pull')) {
    // ERP ids already in AIMS within the last ~1,500 of each list, as "a-b" ranges (the puller skips them).
    const ranges = (ids, from) => { const xs = [...new Set(ids.filter((n) => n >= from))].sort((a, b) => a - b); const out = []; for (const n of xs) { const l = out[out.length - 1]; if (l && n === l[1] + 1) l[1] = n; else out.push([n, n]); } return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(','); };
    const idsOf = (type) => wctErp.filter((d) => d.type === type && /^\d+$/.test(d.erp.erpId)).map((d) => Number(d.erp.erpId));
    const importedQuoteRanges = ranges(idsOf('QUOTATION'), lastQuoteId - 1500), importedInvoiceRanges = ranges(idsOf('INVOICE'), lastInvoiceId - 1500);
    const openQuoteNos = wctErp.filter((d) => d.type === 'QUOTATION' && !['Accepted', 'Declined'].includes(d.erp.status)).map((d) => d.erp.originalNumber).filter(Boolean);
    console.log(`__erpCatchup({ lastQuoteId: ${lastQuoteId}, lastInvoiceId: ${lastInvoiceId}, openQuoteNos: ${JSON.stringify(openQuoteNos)}, importedQuoteRanges: '${importedQuoteRanges}', importedInvoiceRanges: '${importedInvoiceRanges}' })`);
    await c.end();
    return;
  }
  if (!one('--from')) mergeParts();
  if (!fs.existsSync(path.join(OUT, 'erp-invoice-list.csv'))) throw new Error(`no pull in ${OUT}: run the browser puller first (--print-pull)`);

  // Lists (the ERP is slow, so the puller lists only: every document above the last imported id, quotations
  // Sent / Cancelled, invoices Outstanding / Cancelled / Draft / Postponed). An invoice in none of the
  // invoice status lists is Paid.
  const dedupe = (rows) => [...new Map(rows.map((r) => [r.erp_id, r])).values()];
  const qListRaw = readCsv(path.join(OUT, 'erp-quotation-list.csv'));
  const iListRaw = readCsv(path.join(OUT, 'erp-invoice-list.csv'));
  const qList = dedupe(qListRaw), iList = dedupe(iListRaw);
  const listedInvoiceStatus = new Map(iListRaw.filter((r) => /status/.test(r.list)).map((r) => [r.erp_id, r.status]));
  const cnList = readCsv(path.join(OUT, 'erp-credit-note-list.csv'));
  const qDet = readCsv(path.join(OUT, 'wct-quotes-full.csv'));
  const iDet = readCsv(path.join(OUT, 'wct-invoices-full.csv'));
  const iDetById = new Map(iDet.map((r) => [r.erp_id, r]));
  const origCn = new Set(readCsv(path.join(IMPORTS, 'erp/wct-credit-notes.csv')).map((r) => r.credit_note_no));

  const L = [];
  const say = (s = '') => { L.push(s); console.log(s); };
  const money = (n) => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const month = (d) => String(d || '').slice(0, 7);
  const countBy = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const fmt = (o) => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

  say(`WCT old-ERP catch-up · ${ENV.toUpperCase()} DRY RUN · ${new Date().toISOString()} · pull ${OUT}`);
  say('Nothing was written to AIMS or to the ERP.');

  // ── 1. Where AIMS stands ──
  say('\n== 1. Imported so far (AIMS) ==');
  const imp = docs.filter((d) => d.erp);
  for (const org of Object.values(ORG)) {
    for (const type of ['QUOTATION', 'INVOICE', 'CREDIT_NOTE']) {
      const xs = imp.filter((d) => d.org === org && d.type === type);
      if (!xs.length) { say(`${ORG_NAME[org]} ${type}: none imported`); continue; }
      const srcs = fmt(countBy(xs, (d) => d.erp.source));
      const ids = xs.filter((d) => /^\d+$/.test(d.erp.erpId || '')).map((d) => Number(d.erp.erpId));
      const top = xs.slice().sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1))[0];
      const maxName = xs.map((d) => d.name).sort().pop();
      say(`${ORG_NAME[org]} ${type}: ${xs.length} (${srcs}) · highest no. ${maxName} · highest ERP id ${ids.length ? Math.max(...ids) : '-'} · latest date ${top.date} · batches ${[...new Set(xs.map((d) => d.erp.batch))].join(', ')}`);
    }
  }
  say(`Import runs: first import wct-erp-2026-11-05 (logs _imports/wct/erp/wct-erp-import.wct-erp-2026-11-05.log.json); (NG) quotations moved to BC Air 12 Nov; trackers 6-7 Nov; imported orders top-up 18 Nov (_imports/wct/logs/).`);
  const ergQ = qList.slice().sort((a, b) => num(a.erp_id) - num(b.erp_id)).pop();
  const ergI = iList.slice().sort((a, b) => num(a.erp_id) - num(b.erp_id)).pop();
  say(`ERP lists read: quotations above id ${lastQuoteId} + Sent + Cancelled (${qList.length}); invoices above id ${lastInvoiceId} + Outstanding / Cancelled / Draft / Postponed (${iList.length}); credit notes ${cnList.length}.`);
  say(`ERP now: highest quotation ${ergQ.quotation_no} (ERP id ${ergQ.erp_id}, ${ergQ.date}); highest invoice ${ergI.invoice_no} (ERP id ${ergI.erp_id}, ${ergI.date}).`);

  // ── 2. Gap ──
  const haveQ = new Set(wctErp.filter((d) => d.type === 'QUOTATION').map((d) => d.erp.erpId));
  const haveI = new Set(wctErp.filter((d) => d.type === 'INVOICE').map((d) => d.erp.erpId));
  const gapQ = qList.filter((r) => num(r.erp_id) > lastQuoteId);
  const gapI = iList.filter((r) => num(r.erp_id) > lastInvoiceId);
  say('\n== 2. Gap since the last import (ERP ids above the highest imported) ==');
  say(`Quotations: ${gapQ.length} (ERP id > ${lastQuoteId}) · by month ${fmt(countBy(gapQ, (r) => month(r.date)))} · by status ${fmt(countBy(gapQ, (r) => r.status))}`);
  say(`Invoices: ${gapI.length} (ERP id > ${lastInvoiceId}) · by month ${fmt(countBy(gapI, (r) => month(r.date)))} · by status ${fmt(countBy(gapI, (r) => r.status))}`);
  const oldNotIn = qList.filter((r) => num(r.erp_id) <= lastQuoteId && !haveQ.has(r.erp_id) && QUOTE_SCOPE.has(r.status));
  const oldNotInI = iList.filter((r) => num(r.erp_id) <= lastInvoiceId && !haveI.has(r.erp_id) && INVOICE_SCOPE.has(r.status));
  say(`Older ERP documents in scope but never imported, among the lists read (Sent quotations, Outstanding invoices): quotations ${oldNotIn.length}, invoices ${oldNotInI.length} (older Accepted / Paid ones are not listed by this run; older-not-imported.csv).`);
  writeCsv(path.join(OUT, 'older-not-imported.csv'), ['type', 'erp_id', 'no', 'date', 'customer', 'subject', 'total', 'status'], [
    ...oldNotIn.map((r) => ({ type: 'quotation', no: r.quotation_no, ...r })),
    ...oldNotInI.map((r) => ({ type: 'invoice', no: r.invoice_no, ...r })),
  ]);

  // ── 3. New documents ──
  say('\n== 3. New documents (same fields and rules as the first import) ==');
  const newQ = qDet.filter((r) => !haveQ.has(r.erp_id));
  const newI = iDet.filter((r) => !haveI.has(r.erp_id));
  const inQ = newQ.filter((r) => QUOTE_SCOPE.has(r.status));
  const inI = newI.filter((r) => INVOICE_SCOPE.has(r.status));
  say(`Pulled: ${newQ.length} quotations (${fmt(countBy(newQ, (r) => r.status))}), ${newI.length} invoices (${fmt(countBy(newI, (r) => r.status))}).`);
  say(`In scope (quotations Accepted/Declined/Sent, invoices Paid/Overdue/Receivable/Partial): ${inQ.length} quotations, ${inI.length} invoices. Drafts / Certified / Cancelled wait for a later run.`);
  // Pull checks: detail total vs list total, lines vs subtotal.
  const pullIssues = [];
  for (const r of [...newQ, ...newI]) {
    const lt = num(r.list_total || r.total), sub = num(r.subtotal), disc = num(r.discount), gst = num(r.gst_amount);
    if (Math.abs(R2(sub - disc + gst) - lt) > 0.011) pullIssues.push(`${r.quotation_no || r.invoice_no}: lines ${money(sub)} - discount ${money(disc)} + GST ${money(gst)} != list total ${money(lt)}`);
    if (!num(r.line_count)) pullIssues.push(`${r.quotation_no || r.invoice_no}: no lines read`);
  }
  say(`Pull checks (lines - discount + GST = ERP list total, every document has lines): ${pullIssues.length ? pullIssues.length + ' issue(s)' : 'all pass'}`);
  for (const p of pullIssues.slice(0, 30)) say(`  ${p}`);
  // Customers: the first import's reviewed map, then an exact name match in WCT (S).
  const map = new Map(readCsv(path.join(IMPORTS, 'erp/customer-map.csv')).map((r) => [r.erp_customer, r]));
  const wctCust = await q(`select id::text id, name, "customerCode" from "Customer" where "organizationId" = $1`, [ORG.WCT]);
  const bcCust = await q(`select id::text id, name, "customerCode" from "Customer" where "organizationId" = $1`, [ORG.BCAIR]);
  const byN1 = new Map();
  for (const x of wctCust) byN1.set(n1(x.name), [...(byN1.get(n1(x.name)) || []), x]);
  const addMap = [], needDecision = [], toCreateCust = [];
  for (const name of [...new Set([...inQ, ...inI].map((r) => r.customer))]) {
    if (map.has(name)) continue;
    const hits = byN1.get(n1(name)) || [];
    if (hits.length === 1) addMap.push({ erp_customer: name, quotes: '', invoices: '', balance_due: '', match: 'exact', score: '', aims_customer_id: hits[0].id, aims_customer_name: hits[0].name, aims_customer_code: hits[0].customerCode, approved: 'catchup' });
    else if (hits.length > 1) needDecision.push({ name, candidates: hits.map((h) => `${h.customerCode} ${h.name}`).join(' | '), docs: [...inQ, ...inI].filter((r) => r.customer === name).map((r) => r.quotation_no || r.invoice_no).join(' ') });
    else {
      // No exact name: create in WCT (S) (first-import rule). Near names (legal words / punctuation ignored, or one name inside the other) are shown for review.
      const k = normName(name);
      const near = wctCust.filter((x) => { const m = normName(x.name); return m && k && (m === k || (Math.min(m.length, k.length) >= 6 && (m.includes(k) || k.includes(m)))); });
      const docsOf = [...inQ, ...inI].filter((r) => r.customer === name);
      const ngOnly = docsOf.every((r) => r.quotation_no && /\(NG\)/i.test(`${r.subject} ${r.reference_no}`));
      toCreateCust.push({ erp_customer: name, near: near.map((x) => `${x.customerCode} ${x.name}`).join(' | '), docs: docsOf.map((r) => r.quotation_no || r.invoice_no).join(' '), ng_only: ngOnly ? 'yes' : '' });
    }
  }
  say(`New customers to create in WCT (S) (code by the app rule, like the first import's 3): ${toCreateCust.length} (${toCreateCust.filter((x) => x.ng_only).length} only on "(NG)" quotations, so BC Air gets them through the move) · with a near name already in WCT (S): ${toCreateCust.filter((x) => x.near).length}`);
  for (const x of toCreateCust) say(`  CREATE "${x.erp_customer}" (${x.docs})${x.ng_only ? ' [(NG) only]' : ''}${x.near ? ` · near: ${x.near}` : ''}`);
  writeCsv(path.join(OUT, 'customers-to-create.csv'), ['erp_customer', 'docs', 'ng_only', 'near'], toCreateCust);
  say(`Customers: ${[...new Set([...inQ, ...inI].map((r) => r.customer))].length} on new documents · in the first import's map ${[...new Set([...inQ, ...inI].map((r) => r.customer))].filter((n) => map.has(n)).length} · new exact name matches ${addMap.length} · to create ${toCreateCust.length} · several WCT (S) customers with the name (decision) ${needDecision.length}`);
  for (const d of needDecision) say(`  DECISION customer "${d.name}" (${d.docs}): ${d.candidates}`);
  const decidedOut = new Set(needDecision.map((d) => d.name));
  // Importer input: the in-scope documents whose customer is settled.
  const impDir = path.join(OUT, 'import');
  fs.mkdirSync(impDir, { recursive: true });
  // Numbers: none may exist already in WCT (S) or BC Air (a clash is held and listed).
  const names = new Set(docs.filter((d) => d.org === ORG.WCT || d.org === ORG.BCAIR).map((d) => `${d.type}|${d.name}`));
  const clashOf = (r) => names.has(r.quotation_no ? `QUOTATION|Q${r.quotation_no}` : `INVOICE|${r.invoice_no}`);
  const clashRows = [...inQ, ...inI].filter(clashOf);
  const qOk = inQ.filter((r) => !decidedOut.has(r.customer) && !clashOf(r)), iOk = inI.filter((r) => !decidedOut.has(r.customer) && !clashOf(r));
  const lq = readCsv(path.join(OUT, 'wct-quote-lines.csv')), li = readCsv(path.join(OUT, 'wct-invoice-lines.csv'));
  writeCsv(path.join(impDir, 'wct-quotes-full.csv'), Q_COLS, qOk);
  writeCsv(path.join(impDir, 'wct-invoices-full.csv'), I_COLS, iOk.map((r) => ({ ...r, credit_note: cnList.filter((x) => x.invoice_no === r.invoice_no).map((x) => x.credit_note_no).join(' ') })));
  writeCsv(path.join(impDir, 'wct-quote-lines.csv'), L_COLS, lq.filter((l) => qOk.some((r) => r.erp_id === l.erp_id)));
  writeCsv(path.join(impDir, 'wct-invoice-lines.csv'), L_COLS, li.filter((l) => iOk.some((r) => r.erp_id === l.erp_id)));
  const mapRows = readCsv(path.join(IMPORTS, 'erp/customer-map.csv'));
  writeCsv(path.join(impDir, 'customer-map.csv'), Object.keys(mapRows[0]), [...mapRows, ...addMap]);
  say(`Numbers kept (quotations Q-0xxxxx, invoices I-0xxxxx); already used in WCT (S) or BC Air (HELD, not imported): ${clashRows.length ? clashRows.map((r) => `${r.quotation_no ? 'Q' + r.quotation_no : r.invoice_no} (${r.customer}, $${money(num(r.total))}, ${r.status})`).join(', ') : 'none'}`);
  // (NG) quotations go to BC Air (wct-ng-quotes-to-bcair.ts rule: "(NG)" in subject or reference).
  const ngQ = qOk.filter((r) => /\(NG\)/i.test(`${r.subject} ${r.reference_no}`));
  const bcByName = new Map();
  for (const b of bcCust) bcByName.set(normName(b.name), [...(bcByName.get(normName(b.name)) || []), b]);
  say(`"(NG)" quotations -> BC Air: ${ngQ.length} (${ngQ.map((r) => `Q${r.quotation_no}`).join(', ') || 'none'})`);
  const ngCust = {};
  for (const r of ngQ) {
    const hits = bcByName.get(normName(r.customer)) || [];
    ngCust[r.customer] = hits.length === 1 ? `BC Air ${hits[0].customerCode} ${hits[0].name}` : hits.length ? `DECISION: ${hits.length} BC Air customers with this name` : 'new BC Air customer (app code rule)';
  }
  for (const [k, v] of Object.entries(ngCust)) say(`  ${k} -> ${v}`);
  const ngInv = iOk.filter((r) => /\(NG\)/i.test(`${r.subject} ${r.reference_no}`));
  say(`"(NG)" invoices stay in WCT (S) as before: ${ngInv.length} (${fmt(countBy(ngInv, (r) => (num(r.total) <= 1 ? '$0-$1 placeholder' : 'real amount')))})`);

  // The importer's own dry run (read-only) on exactly these files.
  say('\n-- wct-erp-import.js dry run on the new documents --');
  let impOut = '';
  try {
    writeCsv(path.join(impDir, 'create-customers.csv'), ['erp_customer'], toCreateCust);
    impOut = execFileSync('node', [path.join(__dirname, 'wct-erp-import.js'), '--dir', impDir, '--batch', `wct-erp-catchup-${TODAY}`, '--create-customers', path.join(impDir, 'create-customers.csv')], { env: { ...process.env, DBURL: url }, encoding: 'utf8' });
  } catch (e) { impOut = `IMPORTER FAILED: ${String(e.stdout || '')}${String(e.stderr || e.message).split('\n').slice(0, 5).join('\n')}`; }
  for (const l of impOut.trim().split('\n')) say(`  ${l}`);

  // ── 4. Refresh of documents open at import ──
  say('\n== 4. Refresh of imported documents (status / payment fields only) ==');
  const iListById = new Map(iList.map((r) => [r.erp_id, r]));
  const qListById = new Map(qList.map((r) => [r.erp_id, r]));
  const openInv = wctErp.filter((d) => d.type === 'INVOICE' && OPEN_INVOICE.has(d.erp.status));
  const updates = [], refreshRows = [];
  const kinds = {};
  const newCns = cnList.filter((x) => !origCn.has(x.credit_note_no));
  for (const d of openInv) {
    const st = listedInvoiceStatus.get(d.erp.erpId) || 'Paid';
    const e = { ...(iListById.get(d.erp.erpId) || {}), status: st };
    const total = Number(d.total || 0);
    const atImport = Number(d.erp.balanceAtImport ?? d.erp.erpBalanceDue ?? total);
    const aimsOwed = d.outstanding == null ? total : Number(d.outstanding);
    const aimsPaidSinceImport = R2(atImport - aimsOwed); // payments recorded in AIMS after the import
    const cns = newCns.filter((x) => x.invoice_no === d.name);
    let kind, newBal = null;
    if (!e) kind = 'not in ERP list';
    else if (e.status === 'Cancelled') kind = 'cancelled in ERP';
    else if (e.status === 'Paid') { newBal = 0; kind = cns.length ? 'credited (now Paid)' : 'newly paid'; }
    else if (e.status === 'Partial') {
      const det = iDetById.get(d.erp.erpId);
      newBal = det ? num(det.balance_due) : null;
      kind = newBal == null ? 'part paid (balance not read)' : Math.abs(newBal - atImport) < 0.005 ? 'unchanged' : newBal < atImport ? (cns.length ? 'credited (part)' : 'part paid') : 'balance went up';
    } else if (e.status !== d.erp.status) kind = `status ${d.erp.status} -> ${e.status} (no payment)`;
    else kind = cns.length ? 'credit note added' : 'unchanged';
    kinds[kind] = (kinds[kind] || 0) + 1;
    if (kind === 'unchanged') continue;
    const conflict = Math.abs(aimsPaidSinceImport) > 0.005;
    refreshRows.push({ org: ORG_NAME[d.org], invoice: d.name, erp_status_at_import: d.erp.status, erp_status_now: e?.status || '', total, balance_at_import: atImport, balance_now: newBal ?? '', aims_owed_now: aimsOwed, paid_in_aims_since_import: conflict ? aimsPaidSinceImport : '', new_credit_notes: cns.map((x) => `${x.credit_note_no} ${x.total} ${x.status}`).join(' '), change: kind, action: conflict ? 'HOLD: payment also recorded in AIMS' : kind === 'cancelled in ERP' || kind === 'not in ERP list' || kind === 'balance went up' ? 'HOLD: decision' : 'update' });
    if (conflict || newBal == null && !/^status /.test(kind)) continue;
    if (kind === 'cancelled in ERP' || kind === 'not in ERP list' || kind === 'balance went up') continue;
    const owed = newBal == null ? aimsOwed : R2(newBal);
    updates.push({ id: d.id, org: d.org, name: d.name, type: 'INVOICE', erpStatus: e.status, owed, total, docStatus: owed <= 0.005 ? 'paid' : 'pending_payment', creditNotes: cns.map((x) => x.credit_note_no) });
  }
  say(`Invoices open at import (WCT (S), wct-erp): ${openInv.length} · ${fmt(kinds)}`);
  say(`To update: ${updates.length} (Paid ${updates.filter((u) => u.docStatus === 'paid').length}, still owing ${updates.filter((u) => u.docStatus !== 'paid').length}) · held for a decision: ${refreshRows.filter((r) => r.action !== 'update').length}`);
  for (const r of refreshRows.filter((x) => x.action !== 'update')) say(`  ${r.action}: ${r.invoice} ${r.change} (ERP ${r.erp_status_at_import} -> ${r.erp_status_now}, total ${money(r.total)}, owed in AIMS ${money(r.aims_owed_now)}${r.paid_in_aims_since_import !== '' ? `, paid in AIMS since import ${money(r.paid_in_aims_since_import)}` : ''})`);
  // Other imported invoices whose ERP status moved (were Paid at import).
  const reopened = wctErp.filter((d) => d.type === 'INVOICE' && !OPEN_INVOICE.has(d.erp.status) && listedInvoiceStatus.has(d.erp.erpId));
  say(`Invoices Paid at import that the ERP now lists as Outstanding / Cancelled / Draft / Postponed (report only): ${reopened.length}${reopened.length ? ' · ' + fmt(countBy(reopened, (d) => `${d.erp.status} -> ${listedInvoiceStatus.get(d.erp.erpId)}`)) : ''}`);
  for (const d of reopened.slice(0, 20)) say(`  ${d.name}: ${d.erp.status} -> ${listedInvoiceStatus.get(d.erp.erpId)}`);
  say(`New ERP credit notes since the first export: ${newCns.length}${newCns.length ? ' · ' + newCns.map((x) => `${x.credit_note_no} on ${x.invoice_no} $${x.total} ${x.status}`).join('; ') : ''}`);
  // Quotations open at import.
  const openQ = wctErp.filter((d) => d.type === 'QUOTATION' && !['Accepted', 'Declined'].includes(d.erp.status));
  const qChanges = [], qUnknown = [];
  for (const d of openQ) {
    const e = qListById.get(d.erp.erpId);
    if (!e) { qUnknown.push(d.name); continue; }
    if (e.status !== d.erp.status) qChanges.push({ id: d.id, org: d.org, quotation: d.name, was: d.erp.status, now: e.status });
  }
  say(`Quotations open (Sent) at import: ${openQ.length} · status changed: ${qChanges.length}${qChanges.length ? ' · ' + qChanges.map((x) => `${ORG_NAME[x.org]} ${x.quotation} ${x.was} -> ${x.now}`).join(', ') : ''}${qUnknown.length ? ` · not found in the lists read (status not checked): ${qUnknown.join(', ')}` : ''}`);
  for (const x of qChanges) updates.push({ id: x.id, org: x.org, name: x.quotation, type: 'QUOTATION', erpStatus: x.now });
  // Revisions on new quotations.
  const revised = qDet.filter((r) => /-R[1-9]\d*$/.test(r.revision || ''));
  say(`New quotations that are a revision (R1+; the current revision is imported, as before): ${revised.length}${revised.length ? ' · ' + revised.map((r) => `${r.quotation_no} ${r.revision}`).join(', ') : ''}`);
  writeCsv(path.join(OUT, 'refresh-changes.csv'), ['org', 'invoice', 'erp_status_at_import', 'erp_status_now', 'total', 'balance_at_import', 'balance_now', 'aims_owed_now', 'paid_in_aims_since_import', 'new_credit_notes', 'change', 'action'], refreshRows);

  // ── 5. Native AIMS documents that look like new ERP documents ──
  say('\n== 5. Native AIMS documents since cutover vs new ERP documents (list only, nothing touched) ==');
  const natives = docs.filter((d) => !d.erp && (d.type === 'QUOTATION' || d.type === 'INVOICE'));
  say(`Native: ${fmt(countBy(natives, (d) => `${ORG_NAME[d.org]} ${d.type}`))}`);
  const dupRows = [];
  for (const d of natives) {
    const pool = d.type === 'QUOTATION' ? newQ : newI;
    for (const r of pool) {
      const sameCust = n1(r.customer) === n1(d.customerName) || normName(r.customer) === normName(d.customerName);
      const sameSubj = normSubject(r.subject) && normSubject(r.subject) === normSubject(d.subject);
      const sameAmt = Math.abs(num(r.total) - Number(d.total || 0)) < 0.011;
      const score = [sameCust, sameSubj, sameAmt].filter(Boolean).length;
      if (score >= 2) dupRows.push({ org: ORG_NAME[d.org], aims: `${d.type} ${d.name} (${d.status}, ${d.date || ''}, ${d.customerName || ''}, $${money(d.total)})`, erp: `${r.quotation_no || r.invoice_no} (${r.status}, ${r.date}, ${r.customer}, $${money(num(r.total))})`, match: [sameCust && 'customer', sameSubj && 'subject', sameAmt && 'amount'].filter(Boolean).join(' + ') });
    }
  }
  say(dupRows.length ? `Possible duplicates: ${dupRows.length}` : 'Possible duplicates (2 of customer / subject / amount): none');
  for (const r of dupRows) say(`  ${r.org}: ${r.aims} ~ ERP ${r.erp} [${r.match}]`);
  for (const d of natives) say(`  native ${ORG_NAME[d.org]} ${d.type} ${d.name} · ${d.customerName || '-'} · ${String(d.subject || '').slice(0, 60)} · $${money(d.total)} · ${d.status}`);

  // ── 6. Imported orders top-up (dry run with the planned documents) ──
  say('\n== 6. Imported orders top-up (wct-imported-orders.ts dry run + planned documents) ==');
  const sample = (type) => wctErp.find((d) => d.type === type);
  const extra = [];
  for (const r of qOk) extra.push({ id: `planned-quotation-${r.erp_id}`, organizationId: /\(NG\)/i.test(`${r.subject} ${r.reference_no}`) ? ORG.BCAIR : ORG.WCT, type: 'QUOTATION', name: `Q${r.quotation_no}`, status: 'confirmed', config: { date: r.date, customerId: (map.get(r.customer) || addMap.find((m) => m.erp_customer === r.customer) || {}).aims_customer_id || null, customerName: r.customer, subject: r.subject, totalWithTax: num(r.total), items: [], erpImport: { source: 'wct-erp', erpId: r.erp_id, originalNumber: r.quotation_no, status: r.status, contractNo: r.contract_no || null } } });
  for (const r of iOk) extra.push({ id: `planned-invoice-${r.erp_id}`, organizationId: ORG.WCT, type: 'INVOICE', name: r.invoice_no, status: r.status === 'Paid' ? 'paid' : 'pending_payment', config: { date: r.date, customerId: (map.get(r.customer) || addMap.find((m) => m.erp_customer === r.customer) || {}).aims_customer_id || null, customerName: r.customer, subject: r.subject, totalWithTax: num(r.total), outstandingBalance: Math.max(0, num(r.balance_due)), paidToDate: R2(num(r.total) - Math.max(0, num(r.balance_due))), items: lq.length ? li.filter((l) => l.erp_id === r.erp_id && /refer\w*\s+to/i.test(l.description)).map((l) => ({ description: l.description })) : [], erpImport: { source: 'wct-erp', erpId: r.erp_id, originalNumber: r.invoice_no, status: r.status, contractNo: r.contract_no || null, balanceAtImport: Math.max(0, num(r.balance_due)) } } });
  const stored = new Map(docs.map((d) => [d.id, d]));
  for (const u of updates.filter((x) => x.type === 'INVOICE')) {
    const full = (await q(`select id::text id, "organizationId"::text "organizationId", type, name, status::text status, "createdAt", (config - 'items' - 'termsAndConditions') config from "Document" where id = $1`, [u.id]))[0];
    full.config.outstandingBalance = u.owed; full.config.paidToDate = R2(u.total - u.owed); full.config.erpImport = { ...full.config.erpImport, status: u.erpStatus };
    full.status = u.docStatus;
    full.config.items = [];
    extra.push(full);
  }
  void stored; void sample;
  fs.writeFileSync(path.join(OUT, 'planned-docs.json'), JSON.stringify(extra));
  // ERP Quotation No. links: the 18 Nov pull + the new invoices' own link.
  const links = readCsv(path.join(IMPORTS, 'links/quotation-links.csv'));
  const newLinks = iOk.filter((r) => r.erp_quotation_no).map((r) => ({ invoice_no: r.invoice_no, erp_quotation_no: r.erp_quotation_no }));
  writeCsv(path.join(OUT, 'quotation-links-merged.csv'), ['invoice_no', 'erp_quotation_no'], [...links.map((r) => ({ invoice_no: r.invoice_no, erp_quotation_no: r.erp_quotation_no })), ...newLinks]);
  say(`New invoices carrying an ERP Quotation No.: ${newLinks.length} of ${iOk.length}`);
  // Credit notes: the first export + new ones (applied only, as before).
  const origCnRows = readCsv(path.join(IMPORTS, 'erp/wct-credit-notes.csv'));
  writeCsv(path.join(OUT, 'credit-notes-merged.csv'), ['credit_note_no', 'invoice_no', 'total', 'status'], [...origCnRows, ...newCns]);
  let ordOut = '';
  try {
    ordOut = execFileSync('npx', ['ts-node', '--transpile-only', path.join(__dirname, 'wct-imported-orders.ts'), '--env', ENV, '--erp-links', path.join(OUT, 'quotation-links-merged.csv'), '--wct-credit-notes', path.join(OUT, 'credit-notes-merged.csv'), '--extra-docs', path.join(OUT, 'planned-docs.json'), '--out', path.join(OUT, 'orders'), '--org', ORG.WCT, '--org', ORG.BCAIR], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { ordOut = `ORDERS DRY RUN FAILED: ${String(e.stdout || '').slice(-2000)}${String(e.stderr || e.message).split('\n').slice(0, 8).join('\n')}`; }
  for (const l of ordOut.trim().split('\n').filter((x) => !/^\s{2}\S+ \| ORD-/.test(x))) say(`  ${l}`);

  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify({ at: new Date().toISOString(), env: ENV, lastQuoteId, lastInvoiceId, batch: `wct-erp-catchup-${TODAY}`, importDir: impDir, updates, needDecision, holds: refreshRows.filter((r) => r.action !== 'update') }, null, 1));
  writeCsv(path.join(OUT, 'possible-duplicates.csv'), ['org', 'aims', 'erp', 'match'], dupRows);
  writeCsv(path.join(OUT, 'needs-decision-customers.csv'), ['name', 'candidates', 'docs'], needDecision);
  fs.writeFileSync(path.join(OUT, 'catchup-dryrun.txt'), L.join('\n') + '\n');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
