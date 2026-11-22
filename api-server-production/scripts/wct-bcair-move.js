#!/usr/bin/env node
/**
 * Move BC Air work fully into BC Air (2026-11-23, Elroy) · DRY RUN ONLY (read-only session). The apply step is
 * written only after the owner decides on this dry run.
 *
 * Candidates (the ERP's own links): WCT (S) invoices whose ERP quotation is in BC Air (the catch-up's not-linked list,
 * "quotation is in another org (BC Air)"), plus any WCT (S) order / DO / receipt on a BC Air quotation.
 * NOT moved, only listed:
 *  A. documents with journals, payments (receipt allocations included) or credit notes in WCT (S);
 *  B. possible double bills: BC Air already has an invoice on the same quotation for the same amount (within $1) or
 *     dated within 31 days;
 *  C. the ERP invoice header shows WCT (S) as the issuing company / GST no. (from the header check file written by
 *     the ERP-tab read, --headers <json>: { "<erp invoice id>": "WCT (S) / GST 201724603K", ... }; an invoice with
 *     no header read is counted as unknown, never as movable).
 * Also: customer mapping (BC Air customer by UEN, then exact name; else created), AR per org before / after, and the
 * cutover effect (owed amounts of documents dated on or before the 5 Nov opening that would leave WCT (S)).
 *
 *   node scripts/wct-bcair-move.js --env prod [--headers <json>] [--out <dir>]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('pg');

const argv = process.argv.slice(2);
const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev');
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const CUTOVER = '2026-11-05';
const PULL = one('--pull', path.join(os.homedir(), 'Desktop/aims/_imports/wct/erp-catchup/2026-11-23'));
const OUT = one('--out', path.join(PULL, 'bcair-move-dry'));
const R2 = (n) => Math.round(n * 100) / 100;
const money = (n) => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function dbUrl() {
  const key = ENV === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  if (process.env[key]) return process.env[key];
  const line = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not set`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows.filter((r) => r.length > 1);
  return b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file, cols, rows) => fs.writeFileSync(file, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');

(async () => {
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  await c.query('BEGIN TRANSACTION READ ONLY');
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;
  fs.mkdirSync(OUT, { recursive: true });
  const L = [];
  const say = (s = '') => { L.push(s); console.log(s); };
  say(`Move BC Air work into BC Air · ${ENV.toUpperCase()} DRY RUN · ${new Date().toISOString()} · nothing written`);

  // ── Candidates ──
  const notLinked = readCsv(path.join(PULL, 'orders-apply/not-linked.csv')).filter((r) => r.org === 'WCT (S)' && r.why === 'quotation is in another org' && r['other org'] === 'BC Air');
  const keyOf = new Map(notLinked.map((r) => [r.invoice, r['quotation key']]));
  const inv = await q(
    `SELECT d.id::text id, d.name, d.status::text status, d.config->>'date' date, d.config->'erpImport'->>'erpId' "erpId",
            coalesce(d.config->>'customerId', d.config->'customer'->>'id') "customerId", coalesce(d.config->>'customerName', d.config->'customer'->>'name') customer,
            coalesce(d.config->>'totalWithTax', d.config->>'nettTotal')::numeric total, d.config->>'outstandingBalance' owed, (d.config ? 'erpImport') erp,
            (SELECT count(*) FROM "JournalEntry" j WHERE j."sourceDocumentId" = d.id::text AND j.status <> 'VOID')::int journals,
            (SELECT count(*) FROM "Payment" p WHERE p."documentId" = d.id)::int payments,
            (SELECT count(*) FROM "Document" cn WHERE cn."organizationId" = $1 AND cn.type IN ('CREDIT_NOTE','CN') AND cn.config->>'sourceDocumentId' = d.id::text)::int "creditNotes"
       FROM "Document" d WHERE d."organizationId" = $1 AND d.type = 'INVOICE' AND d.name = ANY($2)`,
    [WCT, [...keyOf.keys()]],
  );
  const owedOf = (d) => (d.owed == null || d.owed === '' ? (d.status === 'paid' ? 0 : Number(d.total || 0)) : Math.max(0, Number(d.owed)));
  const ordersOnBc = await q(`SELECT o."orderNumber" FROM "Order" o JOIN "Document" qd ON qd.id = o."sourceQuotationId" WHERE o."organizationId" = $1 AND qd."organizationId" = $2`, [WCT, BC]);
  const dosOnBc = await q(`SELECT d.name FROM "Document" d JOIN "Document" qd ON qd."organizationId" = $2 AND qd.type = 'QUOTATION' AND qd.name = 'Q' || (d.config->'erpImport'->>'quotationNo') WHERE d."organizationId" = $1 AND d.type = 'DELIVERY_ORDER'`, [WCT, BC]);
  say(`\n== Candidates (ERP links) ==`);
  say(`WCT (S) invoices on BC Air quotations: ${inv.length} (of ${notLinked.length} listed), total S$${money(inv.reduce((t, d) => t + Number(d.total || 0), 0))}, owed S$${money(inv.reduce((t, d) => t + owedOf(d), 0))} · ERP-imported ${inv.filter((d) => d.erp).length}, AIMS-native ${inv.filter((d) => !d.erp).length}`);
  say(`WCT (S) orders on BC Air quotations: ${ordersOnBc.length} · WCT (S) DOs on BC Air quotations: ${dosOnBc.length} · receipts: payments on the candidate invoices ${inv.reduce((t, d) => t + d.payments, 0)}`);

  // ── A. journals / payments / credit notes in WCT (S) ──
  const listA = inv.filter((d) => d.journals || d.payments || d.creditNotes);
  // ── B. possible double bills ──
  const bcInv = await q(
    `SELECT d.id::text id, d.name, d.config->>'date' date, coalesce(d.config->>'totalWithTax', d.config->>'nettTotal')::numeric total,
            coalesce(d.config->'erpImport'->>'quotationNo', d.config->>'quotationNo', d.config->>'sourceDocumentNumber', d.config->'trackerImport'->>'quotationNo', '') quote
       FROM "Document" d WHERE d."organizationId" = $1 AND d.type = 'INVOICE' AND coalesce(d.config->>'voided', '') <> 'true'`,
    [BC],
  );
  // BC Air invoices on each BC Air imported order (by the order's quotation key).
  const bcOrders = await q(`SELECT o."linkedDocuments"->'imported'->>'quotationNo' qno, o."orderNumber", o."linkedDocuments"->'invoice' inv FROM "Order" o WHERE o."organizationId" = $1`, [BC]);
  const bcInvById = new Map(bcInv.map((x) => [x.id, x]));
  const qk = (s) => { const m = String(s ?? '').match(/(\d{3,6})(?!.*\d)/); return m ? String(Number(m[1])) : ''; };
  const bcByQuote = new Map();
  for (const o of bcOrders) for (const e of Array.isArray(o.inv) ? o.inv : []) { const x = bcInvById.get(e?.id); const k = qk(o.qno || o.orderNumber); if (x && k) bcByQuote.set(k, [...(bcByQuote.get(k) || []), x]); }
  for (const x of bcInv) { const k = qk(x.quote); if (k && !(bcByQuote.get(k) || []).some((y) => y.id === x.id)) bcByQuote.set(k, [...(bcByQuote.get(k) || []), x]); }
  const days = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
  const listB = [];
  // A WCT (S) $0-$1 "(NG)" placeholder next to BC Air's real invoice is the known placeholder pattern, not a double
  // bill: counted on its own line. A real amount (> $1) with a BC Air invoice on the same quotation for the same
  // amount, or dated within 31 days, is a possible double bill.
  const placeholders = inv.filter((d) => Number(d.total || 0) <= 1);
  for (const d of inv.filter((x) => Number(x.total || 0) > 1)) {
    const k = String(Number(keyOf.get(d.name) || 0));
    for (const x of bcByQuote.get(k) || []) {
      const sameAmt = Math.abs(Number(x.total || 0) - Number(d.total || 0)) <= 1;
      const near = d.date && x.date && days(d.date, x.date) <= 31;
      if (sameAmt || near) listB.push({ wct: d.name, wct_date: d.date, wct_total: Number(d.total || 0), wct_owed: owedOf(d), bcair: x.name, bcair_date: x.date, bcair_total: Number(x.total || 0), why: [sameAmt && 'same amount', near && 'within 31 days'].filter(Boolean).join(' + '), quotation: keyOf.get(d.name) });
    }
  }
  // ── C. ERP header ──
  const headers = one('--headers') ? JSON.parse(fs.readFileSync(one('--headers'), 'utf8')) : {};
  const hdr = (d) => headers[d.erpId] || null;
  const listC = inv.filter((d) => d.erp && /WCT \(S\)|201724603K/i.test(hdr(d) || ''));
  const unknownC = inv.filter((d) => d.erp && !hdr(d));
  const blocked = new Set([...listA.map((d) => d.name), ...listB.map((x) => x.wct), ...listC.map((d) => d.name), ...unknownC.map((d) => d.name)]);
  const movable = inv.filter((d) => !blocked.has(d.name));

  say(`\n== Not moved, listed ==`);
  say(`A. journals / payments / credit notes in WCT (S): ${listA.length} (journals ${listA.filter((d) => d.journals).length}, payments ${listA.filter((d) => d.payments).length}, credit notes ${listA.filter((d) => d.creditNotes).length}) · total S$${money(listA.reduce((t, d) => t + Number(d.total || 0), 0))}`);
  say(`B. possible double bills (real amount, BC Air invoice on the same quotation for the same amount or within 31 days): ${new Set(listB.map((x) => x.wct)).size} WCT (S) invoices (${listB.length} pairs) · total S$${money([...new Map(listB.map((x) => [x.wct, x.wct_total])).values()].reduce((t, n) => t + n, 0))}`);
  say(`   (not a double bill, information: placeholders of $1 or less ${placeholders.length}, total S$${money(placeholders.reduce((t, d) => t + Number(d.total || 0), 0))})`);
  for (const x of listB.slice(0, 12)) say(`   ${x.wct} ${x.wct_date} S$${money(x.wct_total)} ~ BC Air ${x.bcair} ${x.bcair_date} S$${money(x.bcair_total)} [${x.why}] (Q ${x.quotation})`);
  say(`C. ERP invoice header shows WCT (S) (issuing company / GST 201724603K): ${listC.length} · total S$${money(listC.reduce((t, d) => t + Number(d.total || 0), 0))} · owed S$${money(listC.reduce((t, d) => t + owedOf(d), 0))}${unknownC.length ? ` · header not read yet: ${unknownC.length} (never moved until read)` : ''}`);
  say(`\nMovable after A, B, C: ${movable.length} · total S$${money(movable.reduce((t, d) => t + Number(d.total || 0), 0))} · owed S$${money(movable.reduce((t, d) => t + owedOf(d), 0))}`);

  // ── Customer mapping (for the movable set, else for every candidate as information) ──
  const mapSet = movable.length ? movable : inv;
  const wctCust = new Map((await q(`SELECT id::text id, name, uen, "customerCode" FROM "Customer" WHERE "organizationId" = $1`, [WCT])).map((x) => [x.id, x]));
  const bcCust = await q(`SELECT id::text id, name, uen, "customerCode" FROM "Customer" WHERE "organizationId" = $1`, [BC]);
  const bcByUen = new Map(bcCust.filter((x) => x.uen).map((x) => [String(x.uen).toUpperCase().trim(), x]));
  const bcByName = new Map(bcCust.map((x) => [norm(x.name), x]));
  const cmap = new Map();
  for (const d of mapSet) {
    const w = wctCust.get(d.customerId) || { name: d.customer, uen: null };
    const key = d.customerId || d.customer;
    if (cmap.has(key)) continue;
    const byU = w.uen ? bcByUen.get(String(w.uen).toUpperCase().trim()) : null;
    const byN = bcByName.get(norm(w.name));
    cmap.set(key, { wct: `${w.customerCode || ''} ${w.name || d.customer}`.trim(), how: byU ? 'UEN' : byN ? 'exact name' : 'create in BC Air', bcair: byU ? `${byU.customerCode} ${byU.name}` : byN ? `${byN.customerCode} ${byN.name}` : '' });
  }
  const cm = [...cmap.values()];
  say(`\n== Customer mapping (${movable.length ? 'movable invoices' : 'all candidates, information only'}) ==`);
  say(`WCT (S) customers ${cm.length}: matched by UEN ${cm.filter((x) => x.how === 'UEN').length}, by exact name ${cm.filter((x) => x.how === 'exact name').length}, to create in BC Air ${cm.filter((x) => x.how === 'create in BC Air').length} (WCT (S) cards are never moved or deleted)`);

  // ── AR per org, and the cutover effect ──
  const ar = async (org) => (await q(
    `SELECT coalesce(sum(CASE WHEN d.config->>'outstandingBalance' IS NULL OR d.config->>'outstandingBalance' = '' THEN CASE WHEN d.status = 'paid' THEN 0 ELSE coalesce(d.config->>'totalWithTax', d.config->>'nettTotal', '0')::numeric END
                              ELSE greatest(0, (d.config->>'outstandingBalance')::numeric) END), 0) ar
       FROM "Document" d WHERE d."organizationId" = $1 AND d.type = 'INVOICE' AND d.status NOT IN ('draft', 'unconfirmed') AND coalesce(d.config->>'voided', '') <> 'true'`, [org]))[0].ar;
  const arW = Number(await ar(WCT)), arB = Number(await ar(BC));
  const mv = movable.reduce((t, d) => t + owedOf(d), 0);
  say(`\n== AR (owed on confirmed invoices) ==`);
  say(`Before: WCT (S) S$${money(arW)} · BC Air S$${money(arB)}`);
  say(`After (this dry run's movable set): WCT (S) S$${money(arW - mv)} · BC Air S$${money(arB + mv)} (moves S$${money(mv)})`);
  const preCut = movable.filter((d) => String(d.date || '') <= CUTOVER);
  say(`Cutover effect: movable invoices dated on or before ${CUTOVER} (inside WCT (S)'s opening AR from ABSS): ${preCut.length}, owed S$${money(preCut.reduce((t, d) => t + owedOf(d), 0))}. WCT (S)'s opening journal is not changed by a move, so this amount would leave its AR list but stay in its GL AR; BC Air's AR list would gain it with no GL behind it.`);

  writeCsv(path.join(OUT, 'candidates.csv'), ['name', 'date', 'customer', 'total', 'owed', 'status', 'erp', 'journals', 'payments', 'creditNotes', 'quotation', 'erpHeader', 'decision'], inv.map((d) => ({ ...d, owed: owedOf(d), quotation: keyOf.get(d.name), erpHeader: hdr(d) || '', decision: listA.includes(d) ? 'A journals/payments' : listB.some((x) => x.wct === d.name) ? 'B possible double bill' : listC.includes(d) ? 'C ERP header WCT (S)' : unknownC.includes(d) ? 'header not read' : 'movable' })));
  writeCsv(path.join(OUT, 'list-a-journals-payments.csv'), ['name', 'date', 'customer', 'total', 'journals', 'payments', 'creditNotes'], listA);
  writeCsv(path.join(OUT, 'list-b-double-bills.csv'), ['wct', 'wct_date', 'wct_total', 'wct_owed', 'bcair', 'bcair_date', 'bcair_total', 'why', 'quotation'], listB);
  writeCsv(path.join(OUT, 'list-c-erp-header-wct.csv'), ['name', 'date', 'customer', 'total', 'erpHeader'], listC.map((d) => ({ ...d, erpHeader: hdr(d) })));
  writeCsv(path.join(OUT, 'customer-mapping.csv'), ['wct', 'how', 'bcair'], cm);
  fs.writeFileSync(path.join(OUT, 'dryrun.txt'), L.join('\n') + '\n');
  say(`\nFiles: ${OUT}`);
  await c.query('ROLLBACK');
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
