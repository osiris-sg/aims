/**
 * ERP Draft quotations from a catch-up pull (Elroy 19 Nov 2026: import them too). Builds an import folder with only
 * the pull's Draft quotations not in AIMS yet, for wct-erp-import.js --quote-scope Draft (same rules: imported
 * marker, GL guard, numbers kept). Customers: the catch-up's map (owner decisions included), else one WCT (S)
 * customer with the exact name, else created by the importer ("(NG)"-only ones are created in WCT (S) for the import,
 * moved to BC Air by wct-ng-quotes-to-bcair.ts and removed after, as in the catch-up). Read-only.
 *   node scripts/wct-erp-catchup-drafts.js --env prod --pull <catch-up pull folder>
 * Writes <pull>-drafts/ (import CSVs, customer-map.csv, create-customers.csv, customers-to-create.csv).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const argv = process.argv.slice(2);
const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev');
const PULL = one('--pull');
const OUT = `${String(PULL).replace(/\/$/, '')}-drafts`;
const parse = (text) => {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows.filter((r) => r.length > 1);
  return { head: h, rows: b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))) };
};
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const write = (f, cols, rows) => fs.writeFileSync(path.join(OUT, f), '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
const n1 = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/’/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(pteltd|privatelimited|ltd|llp)$/, '');

(async () => {
  if (!PULL || !fs.existsSync(PULL)) throw new Error('--pull <catch-up pull folder>');
  const c = new Client({ connectionString: ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const have = new Set((await c.query(`select config->'erpImport'->>'erpId' id from "Document" where type = 'QUOTATION' and config->'erpImport'->>'source' = 'wct-erp' and "organizationId"::text = any($1::text[])`, [[WCT, BCAIR]])).rows.map((r) => r.id));
  const Q = parse(fs.readFileSync(path.join(PULL, 'wct-quotes-full.csv'), 'utf8'));
  const L = parse(fs.readFileSync(path.join(PULL, 'wct-quote-lines.csv'), 'utf8'));
  const drafts = Q.rows.filter((r) => r.status === 'Draft' && !have.has(r.erp_id));
  const ids = new Set(drafts.map((r) => r.erp_id));
  fs.mkdirSync(OUT, { recursive: true });
  write('wct-quotes-full.csv', Q.head, drafts);
  write('wct-quote-lines.csv', L.head, L.rows.filter((l) => ids.has(l.erp_id)));
  write('wct-invoices-full.csv', ['erp_id', 'erp_revision_id', 'invoice_no', 'revision', 'date', 'status', 'payment_term', 'department', 'reference_no', 'po_number', 'our_do_no', 'your_ref', 'customer', 'client_site', 'billing_address', 'job_location', 'attention', 'attention_title', 'attention_mobile', 'attention_email', 'attention_tel', 'contract_no', 'service_order', 'sales_person', 'sales_email', 'sales_phone', 'coordinator', 'subject', 'sub_heading', 'subtotal', 'discount', 'gst_rate', 'gst_amount', 'total', 'balance_due', 'credit_note', 'line_count', 'notes', 'terms'], []);
  write('wct-invoice-lines.csv', ['erp_id', 'doc_no', 'line_no', 'description', 'qty', 'unit_price', 'discount', 'amount'], []);
  // Customers.
  const map = parse(fs.readFileSync(path.join(PULL, 'import', 'customer-map.csv'), 'utf8'));
  const mapped = new Map(map.rows.map((r) => [r.erp_customer, r]));
  const wct = (await c.query(`select id::text id, name, "customerCode" from "Customer" where "organizationId" = $1`, [WCT])).rows;
  const bc = new Map((await c.query(`select id::text id, name, "customerCode" from "Customer" where "organizationId" = $1`, [BCAIR])).rows.map((b) => [normName(b.name), b]));
  const byN1 = new Map();
  for (const x of wct) byN1.set(n1(x.name), [...(byN1.get(n1(x.name)) || []), x]);
  const add = [], create = [], decide = [];
  for (const name of [...new Set(drafts.map((r) => r.customer))]) {
    if (mapped.has(name)) continue;
    const hits = byN1.get(n1(name)) || [];
    if (hits.length === 1) add.push({ erp_customer: name, quotes: '', invoices: '', balance_due: '', match: 'exact', score: '', aims_customer_id: hits[0].id, aims_customer_name: hits[0].name, aims_customer_code: hits[0].customerCode, approved: 'catchup-drafts' });
    else if (hits.length > 1) decide.push(`${name}: ${hits.map((h) => h.customerCode).join(', ')}`);
    else {
      const docs = drafts.filter((r) => r.customer === name);
      const ngOnly = docs.every((r) => /\(NG\)/i.test(`${r.subject} ${r.reference_no}`));
      create.push({ erp_customer: name, docs: docs.map((r) => r.quotation_no).join(' '), ng_only: ngOnly ? 'yes' : '', near: '' });
    }
  }
  create.sort((a, b) => (a.ng_only ? 1 : 0) - (b.ng_only ? 1 : 0));
  write('customer-map.csv', map.head, [...map.rows, ...add]);
  write('create-customers.csv', ['erp_customer'], create);
  write('customers-to-create.csv', ['erp_customer', 'docs', 'ng_only', 'near'], create);
  const ng = drafts.filter((r) => /\(NG\)/i.test(`${r.subject} ${r.reference_no}`));
  console.log(`Draft quotations to import: ${drafts.length} (skipped, already in AIMS: ${Q.rows.filter((r) => r.status === 'Draft').length - drafts.length}) · "(NG)" -> BC Air after the import: ${ng.length} · total ${drafts.reduce((t, r) => t + Number(r.total || 0), 0).toFixed(2)}`);
  console.log(`customers: in the catch-up map ${[...new Set(drafts.map((r) => r.customer))].filter((n) => mapped.has(n)).length} · exact name ${add.length} · to create ${create.length} (${create.filter((x) => x.ng_only).length} only on "(NG)": BC Air ${create.filter((x) => x.ng_only).map((x) => (bc.has(normName(x.erp_customer)) ? `existing ${bc.get(normName(x.erp_customer)).customerCode}` : 'new')).join(', ') || '-'}) · need a decision ${decide.length}`);
  for (const x of create) console.log(`  create ${x.ng_only ? '(NG only) ' : ''}"${x.erp_customer}" (${x.docs})`);
  for (const d of decide) console.log(`  DECISION ${d}`);
  console.log(`folder: ${OUT}`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
