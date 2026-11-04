/**
 * WCT ERP import (2026-11-05): WCT's past quotations and invoices from their previous ERP, as
 * HISTORY documents. Documents only: no GL, no opening AR, no Payment rows, no emails / Xero /
 * WhatsApp / SiteClock / counters. Every row carries config.erpImport (src/common/erp-import.ts),
 * which keeps it out of the GL, the posting queue, Xero confirm and the AI index, and shows an
 * "Imported" tag.
 *
 * Input (gitignored, never committed): _imports/wct/erp/ at the repo root
 *   wct-quotes-full.csv, wct-quote-lines.csv, wct-invoices-full.csv, wct-invoice-lines.csv,
 *   customer-map.csv (the reviewed mapping from the stage 1 dry run).
 * Scope: quotes Accepted / Declined / Sent; invoices Paid / Overdue / Receivable / Partial
 * (Draft and Cancelled skipped).
 *
 *   DBURL=… node scripts/wct-erp-import.js                       dry run (read-only), final counts
 *   DBURL=… node scripts/wct-erp-import.js --apply               insert, 500 per transaction
 *   DBURL=… node scripts/wct-erp-import.js --rollback            dry run of the rollback
 *   DBURL=… node scripts/wct-erp-import.js --rollback --apply    delete this batch's rows only
 * Options: --batch <id> (default wct-erp-2026-11-05), --dir <csv folder>, --limit <n> (test runs),
 *          --search-path <schemas> (dev DB per-org schemas only; prod is the public schema),
 *          --remap-by-name (dev only: map customers by name, else the first customer, since dev
 *          has other customer ids).
 *
 * Numbers: invoices keep "I-015128"; quotes "-014856" become "Q-014856" (a second quote with the
 * same ERP number gets "-2"). Counters (DocumentNumberFormat) are never read for writing nor
 * advanced; WCT's prefixes (INV2026…, QO2026…) never match these names.
 * Idempotent: a document whose (type, erpId) is already in the org is skipped.
 * Every write is logged to scripts/wct-erp-import.<batch>.log.json.
 */
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const BATCH = opt('--batch', 'wct-erp-2026-11-05');
const DIR = opt('--dir', path.resolve(__dirname, '../../_imports/wct/erp'));
const LIMIT = args.includes('--limit') ? Number(opt('--limit')) : Infinity;
const SEARCH_PATH = opt('--search-path', null);
const REMAP = args.includes('--remap-by-name');
const CHUNK = 500;
const SOURCE = 'wct-erp';
const LOG = path.resolve(__dirname, `wct-erp-import.${BATCH}.log.json`);

const QUOTE_SCOPE = new Set(['Accepted', 'Declined', 'Sent']);
const INVOICE_SCOPE = new Set(['Paid', 'Overdue', 'Receivable', 'Partial']);
// Decided with the owner (2026-11-05).
const SKIP_CUSTOMERS = new Set(['WCT (S) SYSTEMS PTE LTD']); // internal test
const CREATE_CUSTOMERS = {
  '(CANCEL) Dsign Signature Builder Pte Ltd': { name: 'Dsign Signature Builder Pte Ltd', reuseExisting: true },
  '88rounding Pte Ltd': { name: '88rounding Pte Ltd' },
  'MCST 1166': { name: 'MCST 1166' },
};
// createdAt: the document's own date (09:00 SGT), but never on or after WCT's first AIMS document
// (2026-11-02), so "open the latest invoice / quotation" and newest-first lists stay on AIMS's own.
const CREATED_CAP = Date.parse('2026-11-02T00:00:00+08:00');

// ── CSV (RFC 4180: quoted fields, "" escapes, newlines inside quotes) ──────────
function readCsv(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const num = (s) => {
  const n = Number(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const R2 = (n) => Math.round(n * 100) / 100;
const clean = (s) => String(s || '').replace(/^\[NA\]\s*/, '').trim();
// Same normalisation as the stage 1 matcher (case / punctuation-insensitive).
const n1 = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/’/g, "'").replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).join(' ');
const LEGAL = new Set(['pte', 'ltd', 'private', 'limited', 'llp', 'co', 'inc', 'the', 's', 'sg', 'plc', 'corp', 'corporation', 'company']);
const n2 = (s) => n1(s).split(' ').filter((w) => !LEGAL.has(w)).join(' ');
const bigrams = (s) => { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); } return out; };
function similarity(a, b) {
  a = n1(a); b = n1(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return (2 * inter) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
}
const codeKey = (c) => { const m = /^([A-Z]+)(\d+)$/i.exec(c || ''); return m ? [m[1], Number(m[2])] : [c || '~', 0]; };
const byCode = (a, b) => { const [pa, na] = codeKey(a.customerCode), [pb, nb] = codeKey(b.customerCode); return pa === pb ? na - nb : pa < pb ? -1 : 1; };

// CustomersService.generateCustomerCode: C + first A-Z/0-9 of the name + max(existing)+1, 3 digits.
function nextCustomerCode(name, customers) {
  const first = String(name || '').normalize('NFD').toUpperCase().match(/[A-Z0-9]/)?.[0] || 'X';
  const prefix = `C${first}`;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const c of customers) { const m = re.exec(c.customerCode || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function main() {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  if (SEARCH_PATH) await c.query(`SET search_path TO ${SEARCH_PATH.split(',').map((x) => `"${x.replace(/"/g, '')}"`).join(', ')}`);
  // A dry run never writes: everything happens in one read-only transaction.
  if (!APPLY) await c.query('BEGIN READ ONLY');
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const log = { batch: BATCH, mode: `${ROLLBACK ? 'ROLLBACK' : 'IMPORT'} ${APPLY ? 'APPLY' : 'DRY-RUN'}`, startedAt: new Date().toISOString(), writes: [] };
  const saveLog = () => APPLY && fs.writeFileSync(LOG.replace('.log.json', ROLLBACK ? '.rollback.log.json' : '.log.json'), JSON.stringify(log, null, 1));

  const org = (await q(`select id, name from "Organization" where id = $1`, [WCT]))[0];
  if (!org || org.name !== 'WCT') throw new Error(`WCT org ${WCT} not found (got ${JSON.stringify(org)})`);
  // One run at a time (released when the session ends).
  const lock = (await q(`select pg_try_advisory_lock(hashtext('wct-erp-import')) ok`))[0].ok;
  if (!lock) throw new Error('another wct-erp-import run holds the lock');

  const formatsBefore = await q(`select "documentType", pattern, "nextSerial", "lastResetKey", "updatedAt" from "DocumentNumberFormat" where "organizationId" = $1 order by "documentType"`, [WCT]);

  if (ROLLBACK) return rollback(c, q, log, saveLog, formatsBefore);

  // ── Reference data ────────────────────────────────────────────────────────
  const templates = await q(`select id, type, name from "DocumentTemplate" where "organizationId" = $1 and type in ('INVOICE','QUOTATION') and name in ('WCT Tax Invoice','WCT Quotation')`, [WCT]);
  const tpl = Object.fromEntries(templates.map((t) => [t.type, t.id]));
  if (!tpl.INVOICE || !tpl.QUOTATION || templates.length !== 2) throw new Error(`expected the WCT Tax Invoice + WCT Quotation templates, got ${JSON.stringify(templates)}`);
  const sample = async (type) => (await q(`select config from "Document" where "organizationId" = $1 and type = $2 and not (config ? 'erpImport') order by "createdAt" desc limit 1`, [WCT, type]))[0]?.config || {};
  const sInv = await sample('INVOICE');
  const sQuo = await sample('QUOTATION');
  const company = sInv.company || sQuo.company || { name: 'WCT' };
  const gstRegNo = sInv.gstRegNo || sQuo.gstRegNo || '';

  const customers = await q(`select id, name, "customerCode", address from "Customer" where "organizationId" = $1`, [WCT]);
  const custById = new Map(customers.map((x) => [x.id, x]));
  const byN1 = new Map();
  for (const x of customers) { const k = n1(x.name); byN1.set(k, [...(byN1.get(k) || []), x]); }

  const mapRows = readCsv('customer-map.csv');
  const map = new Map(mapRows.map((r) => [r.erp_customer, r]));

  const existing = await q(`select type, config->'erpImport'->>'erpId' erp_id from "Document" where "organizationId" = $1 and config ? 'erpImport'`, [WCT]);
  const have = new Set(existing.map((r) => `${r.type}:${r.erp_id}`));
  const namesTaken = new Set((await q(`select "documentTemplateId" t, name from "Document" where "organizationId" = $1 and name is not null`, [WCT])).map((r) => `${r.t}|${r.name}`));

  // ── ERP data ──────────────────────────────────────────────────────────────
  const quotesAll = readCsv('wct-quotes-full.csv');
  const invoicesAll = readCsv('wct-invoices-full.csv');
  const lines = new Map();
  for (const [f, k] of [['wct-quote-lines.csv', 'Q'], ['wct-invoice-lines.csv', 'I']]) {
    for (const l of readCsv(f)) { const key = `${k}:${l.erp_id}`; (lines.get(key) || lines.set(key, []).get(key)).push(l); }
  }
  for (const v of lines.values()) v.sort((a, b) => num(a.line_no) - num(b.line_no));
  const quotes = quotesAll.filter((r) => QUOTE_SCOPE.has(r.status)).sort((a, b) => num(a.erp_id) - num(b.erp_id));
  const invoices = invoicesAll.filter((r) => INVOICE_SCOPE.has(r.status)).sort((a, b) => num(a.erp_id) - num(b.erp_id));

  // ── Customers ─────────────────────────────────────────────────────────────
  const toCreate = new Map(); // erp name → { name, code, address, existing? }
  const customerPicks = { mapped: 0, perDocument: 0, created: 0, skipped: 0 };
  const perDocPicks = [];
  function customerFor(r, kind) {
    const name = r.customer;
    if (SKIP_CUSTOMERS.has(name)) return { skip: true };
    if (CREATE_CUSTOMERS[name]) return { create: name };
    const m = map.get(name);
    if (!m) throw new Error(`customer "${name}" (${kind} ${r.erp_id}) is not in customer-map.csv`);
    if ((m.match === 'exact' || m.match === 'ambiguous-picked-by-address') && m.aims_customer_id) {
      let cust = custById.get(m.aims_customer_id);
      // --remap-by-name: dev only (its customers have other ids); never used on prod.
      if (!cust && REMAP) cust = customers.filter((x) => n1(x.name) === n1(m.aims_customer_name.split(' | ')[0])).sort(byCode)[0] || customers.slice().sort(byCode)[0];
      if (!cust) throw new Error(`customer-map: ${m.aims_customer_id} (${name}) no longer exists`);
      return { customer: cust, how: 'mapped' };
    }
    if (m.match === 'ambiguous-exact') {
      const cands = (byN1.get(n1(name)) || []).slice().sort(byCode);
      if (cands.length < 2 && REMAP && customers.length) return { customer: customers.slice().sort(byCode)[0], how: 'perDocument' };
      if (cands.length < 2) throw new Error(`"${name}": expected 2+ AIMS customers, found ${cands.length}`);
      const addr = [clean(r.billing_address), clean(r.client_site), clean(r.job_location)].filter(Boolean);
      const scored = cands.map((x) => ({ x, s: Math.max(0, ...addr.map((a) => similarity(a, x.address))) }));
      scored.sort((a, b) => b.s - a.s || byCode(a.x, b.x));
      const tie = scored.length > 1 && Math.abs(scored[0].s - scored[1].s) < 0.05;
      const pick = tie ? cands[0] : scored[0].x; // still tied → the lower customer code
      perDocPicks.push({ erp: name, doc: r.erp_id, kind, picked: pick.customerCode, by: tie ? 'lower code (tie)' : `address ${scored[0].s.toFixed(2)}` });
      return { customer: pick, how: 'perDocument' };
    }
    throw new Error(`customer "${name}" has match "${m.match}" with no rule`);
  }
  for (const [erpName, spec] of Object.entries(CREATE_CUSTOMERS)) {
    const reuse = spec.reuseExisting ? customers.filter((x) => n2(x.name) === n2(spec.name)).sort(byCode)[0] : null;
    const docs = [...quotes, ...invoices].filter((r) => r.customer === erpName);
    const latest = docs.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (reuse) toCreate.set(erpName, { existing: reuse });
    else toCreate.set(erpName, { name: spec.name, address: clean(latest?.billing_address) || null });
  }
  // Codes are given in a fixed order so a dry run shows exactly what apply will create.
  const pool = [...customers];
  for (const v of toCreate.values()) {
    if (v.existing) continue;
    v.code = nextCustomerCode(v.name, pool);
    v.id = crypto.randomUUID();
    pool.push({ customerCode: v.code });
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  const docs = [];
  const skipped = { already: 0, internal: 0 };
  const quoteNames = new Map();
  const items = (rows, rate) =>
    rows.map((l) => {
      const disc = String(l.discount || '').trim();
      return {
        id: num(l.erp_id) * 1000 + num(l.line_no),
        itemCode: '',
        description: l.description,
        quantity: num(l.qty),
        unitPrice: num(l.unit_price),
        ...(disc && disc !== '0%' ? { discount: disc } : {}),
        amount: num(l.amount),
        tax: String(rate),
        uom: '',
        isService: true,
        revenueTag: 'service',
        accountCode: '',
        inventoryItemId: '',
      };
    });
  const build = (r, kind) => {
    const isInv = kind === 'INVOICE';
    const type = kind;
    if (have.has(`${type}:${r.erp_id}`)) { skipped.already++; return null; }
    const who = customerFor(r, kind);
    if (who.skip) { skipped.internal++; customerPicks.skipped++; return null; }
    let cust;
    if (who.create) {
      const v = toCreate.get(who.create);
      cust = v.existing || { id: v.id, name: v.name, customerCode: v.code };
      customerPicks.created++;
    } else {
      cust = who.customer;
      customerPicks[who.how]++;
    }
    let name;
    if (isInv) name = r.invoice_no;
    else {
      const base = `Q${r.quotation_no}`;
      const n = (quoteNames.get(base) || 0) + 1;
      quoteNames.set(base, n);
      name = n === 1 ? base : `${base}-${n}`;
    }
    const rate = r.gst_rate === '---' || r.gst_rate === '' ? 0 : num(r.gst_rate);
    const subtotal = num(r.subtotal), discount = num(r.discount), gst = num(r.gst_amount), total = num(r.total);
    const erpBalance = isInv ? num(r.balance_due) : null;
    const owed = isInv ? Math.max(0, R2(erpBalance)) : null;
    const attn = [r.attention_title, r.attention].filter(Boolean).join(' ').trim();
    const phone = r.attention_mobile || r.attention_tel || '';
    const serial = num((r.invoice_no || r.quotation_no).replace(/\D/g, ''));
    const docTime = Date.parse(`${r.date}T09:00:00+08:00`) + (serial % 3600) * 1000;
    const createdAt = new Date(Math.min(docTime, CREATED_CAP - (100000 - serial) * 1000));
    const erpImport = {
      source: SOURCE,
      batch: BATCH,
      erpId: r.erp_id,
      erpRevisionId: r.erp_revision_id || null,
      originalNumber: isInv ? r.invoice_no : r.quotation_no,
      revision: r.revision || null,
      status: r.status,
      ...(isInv ? { balanceAtImport: owed, erpBalanceDue: R2(erpBalance), creditNote: r.credit_note || null, paymentTerm: r.payment_term || null } : { listTotal: r.list_total ? num(r.list_total) : null }),
      erpCustomer: r.customer,
      clientSite: r.client_site || null,
      department: r.department || null,
      referenceNo: r.reference_no || null,
      ...(isInv ? { poNumber: r.po_number || null, ourDoNo: r.our_do_no || null, yourRef: r.your_ref || null } : {}),
      contractNo: r.contract_no || null,
      serviceOrder: r.service_order || null,
      salesEmail: r.sales_email || null,
      coordinator: r.coordinator || null,
      subHeading: r.sub_heading || null,
      gstRate: r.gst_rate,
      lineCount: num(r.line_count),
      importedAt: new Date().toISOString(),
    };
    let config = {
      date: r.date,
      dueDate: r.date,
      documentNumber: name,
      currency: 'SGD',
      company,
      gstRegNo,
      footerMessage: (isInv ? sInv : sQuo).footerMessage || '',
      customerId: cust.id,
      customerCode: cust.customerCode || '',
      customerName: cust.name,
      customerEmail: '',
      customerAddress: '',
      billTo: clean(r.billing_address),
      location: clean(r.job_location),
      deliveryTo: '',
      collectFrom: '',
      attention: { name: attn, email: r.attention_email || '', phoneNumber: phone },
      contact: [attn, phone].filter(Boolean).join(' - '),
      subject: r.subject || '',
      referenceNo: isInv ? r.reference_no || r.po_number || r.your_ref || r.subject || '' : r.subject || r.reference_no || '',
      salesPerson: r.sales_person || '',
      salesMobile: r.sales_phone || '',
      paymentTerms: isInv ? r.payment_term || '' : '',
      remarks: r.notes || '',
      termsAndConditions: r.terms || '',
      note: '',
      issueBy: '',
      projectName: '',
      items: items(lines.get(`${isInv ? 'I' : 'Q'}:${r.erp_id}`) || [], rate),
      grossTotal: R2(subtotal),
      ...(discount ? { discountAmount: R2(discount) } : { discountAmount: 0 }),
      subTotal: R2(subtotal - discount),
      gstAmount: R2(gst),
      nettTotal: R2(total),
      gstPercent: rate,
      taxApplicable: rate > 0 ? 'Y' : 'N',
      absorbTax: 'N',
      showTotals: true,
      confirmedAt: createdAt.toISOString(),
      sourceDocumentId: '',
      sourceDocumentType: '',
      sourceDocumentNumber: '',
      erpImport,
    };
    // Money keys via the same rule as stampDocumentMoney (canonical + legacy twins).
    config.totalWithTax = R2(total); config.xeroGross = R2(total);
    if (isInv) {
      config.outstandingBalance = owed; config.xeroBalance = owed;
      config.paidToDate = R2(total - owed); config.xeroAmountPaid = R2(total - owed);
    }
    const tplId = tpl[type];
    if (namesTaken.has(`${tplId}|${name}`)) throw new Error(`number ${name} already exists in AIMS (${type})`);
    namesTaken.add(`${tplId}|${name}`);
    return {
      id: crypto.randomUUID(),
      type,
      name,
      status: isInv ? (r.status === 'Paid' ? 'paid' : 'pending_payment') : 'confirmed',
      templateId: tplId,
      createdAt,
      config,
      erpStatus: r.status,
      year: r.date.slice(0, 4),
      total,
      owed,
      customerId: cust.id,
      newCustomer: !!who.create,
    };
  };
  for (const r of quotes) { const d = build(r, 'QUOTATION'); if (d) docs.push(d); }
  for (const r of invoices) { const d = build(r, 'INVOICE'); if (d) docs.push(d); }
  // --limit n (test runs): the first n/2 quotes and n/2 invoices.
  const plan = LIMIT === Infinity ? docs : [...docs.filter((d) => d.type === 'QUOTATION').slice(0, Math.ceil(LIMIT / 2)), ...docs.filter((d) => d.type === 'INVOICE').slice(0, Math.floor(LIMIT / 2))];

  // ── Report ────────────────────────────────────────────────────────────────
  const count = (f) => plan.reduce((m, d) => { const k = f(d); m[k] = (m[k] || 0) + 1; return m; }, {});
  const sum = (f, pred = () => true) => R2(plan.filter(pred).reduce((s, d) => s + f(d), 0));
  console.log(`\n=== WCT ERP import · batch ${BATCH} · ${log.mode}${LIMIT !== Infinity ? ` · limit ${LIMIT}` : ''} ===`);
  console.log(`in scope: ${quotes.length} quotes, ${invoices.length} invoices · already imported (skipped): ${skipped.already} · internal test customer (skipped): ${skipped.internal}`);
  console.log(`to insert: ${plan.length} documents`, JSON.stringify(count((d) => `${d.type} ${d.erpStatus} → ${d.status}`)));
  console.log(`quotes total ${sum((d) => d.total, (d) => d.type === 'QUOTATION')} · invoices total ${sum((d) => d.total, (d) => d.type === 'INVOICE')} · owed on open invoices ${sum((d) => d.owed || 0, (d) => d.type === 'INVOICE')} over ${plan.filter((d) => d.type === 'INVOICE' && d.owed > 0.005).length} invoices`);
  console.log('by year (docs):', JSON.stringify(count((d) => `${d.year} ${d.type === 'INVOICE' ? 'I' : 'Q'}`)));
  console.log(`customers: mapped ${customerPicks.mapped} docs, picked per document ${customerPicks.perDocument} docs, new/reused for ${customerPicks.created} docs`);
  for (const [erp, v] of toCreate) console.log(v.existing ? `  reuse existing ${v.existing.customerCode} "${v.existing.name}" for ERP "${erp}"` : `  CREATE ${v.code} "${v.name}" (address: ${v.address || '-'}) for ERP "${erp}"`);
  const pickSummary = perDocPicks.reduce((m, p) => { const k = `${p.erp} → ${p.picked} (${p.by.startsWith('lower') ? 'tie: lower code' : 'address'})`; m[k] = (m[k] || 0) + 1; return m; }, {});
  for (const [k, n] of Object.entries(pickSummary)) console.log(`  per-document pick: ${k} × ${n}`);
  console.log(`duplicate quote numbers renamed: ${[...quoteNames].filter(([, n]) => n > 1).map(([b, n]) => `${b} ×${n} → ${b}-2`).join(', ') || 'none'}`);
  console.log(`createdAt range: ${new Date(Math.min(...plan.map((d) => +d.createdAt))).toISOString()} .. ${new Date(Math.max(...plan.map((d) => +d.createdAt))).toISOString()}`);
  console.log('number formats (unchanged by this script):', JSON.stringify(formatsBefore.filter((f) => ['INVOICE', 'QUOTATION'].includes(f.documentType)).map((f) => `${f.documentType} ${f.pattern} next=${f.nextSerial}`)));
  log.plan = { documents: plan.length, byStatus: count((d) => `${d.type} ${d.status}`), customersToCreate: [...toCreate.values()].filter((v) => !v.existing).map((v) => ({ code: v.code, name: v.name })), perDocPicks: pickSummary };

  if (!APPLY) { await c.query('ROLLBACK'); await c.end(); return; }

  // ── Apply ─────────────────────────────────────────────────────────────────
  const now = new Date();
  await c.query('BEGIN');
  for (const [erp, v] of toCreate) {
    if (v.existing) continue;
    if (!plan.some((d) => d.newCustomer && d.config.customerId === v.id)) continue;
    await c.query(
      `insert into "Customer" (id, name, "customerCode", address, "organizationId", "externalRef", currency, "createdAt", "updatedAt") values ($1,$2,$3,$4,$5,$6,'SGD',$7,$7)`,
      [v.id, v.name, v.code, v.address, WCT, `erp-import:${BATCH}`, now],
    );
    log.writes.push({ op: 'INSERT Customer', id: v.id, code: v.code, name: v.name, erpName: erp });
  }
  await c.query('COMMIT');
  saveLog();
  let done = 0;
  for (let i = 0; i < plan.length; i += CHUNK) {
    const part = plan.slice(i, i + CHUNK);
    await c.query('BEGIN');
    try {
      const vals = [];
      const ph = part.map((d, k) => {
        vals.push(d.id, d.createdAt, JSON.stringify(d.config), d.templateId, d.type, WCT, d.name, d.status);
        const b = k * 8;
        return `($${b + 1}::uuid,$${b + 2},$${b + 2},$${b + 3}::jsonb,$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8}::"DocumentStatus",0,0)`;
      });
      const res = await c.query(
        `insert into "Document" (id, "createdAt", "updatedAt", config, "documentTemplateId", type, "organizationId", name, status, "revisionNumber", version) values ${ph.join(',')}`,
        vals,
      );
      if (res.rowCount !== part.length) throw new Error(`inserted ${res.rowCount}, expected ${part.length}`);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      log.error = `chunk at ${i}: ${e.message}`;
      saveLog();
      throw e;
    }
    done += part.length;
    log.writes.push({ op: 'INSERT Document', chunk: i / CHUNK + 1, count: part.length, ids: part.map((d) => d.id) });
    saveLog();
    process.stdout.write(`\r  inserted ${done}/${plan.length}`);
  }
  console.log('');
  await c.query(
    `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status, "createdAt") values ($1,'SYSTEM','system:wct-erp-import','System creation',$2,'cron','IMPORT','documents',$3::jsonb,'SUCCESS',now())`,
    [crypto.randomUUID(), WCT, JSON.stringify({ note: `Imported WCT ERP history, batch ${BATCH}`, batch: BATCH, documents: done, byStatus: log.plan.byStatus, customersCreated: log.plan.customersToCreate })],
  );
  log.writes.push({ op: 'INSERT ActionLog', action: 'IMPORT', documents: done });
  await verify(q, log, formatsBefore);
  log.finishedAt = new Date().toISOString();
  saveLog();
  await c.end();
}

async function verify(q, log, formatsBefore) {
  const after = await q(`select "documentType", pattern, "nextSerial", "lastResetKey", "updatedAt" from "DocumentNumberFormat" where "organizationId" = $1 order by "documentType"`, [WCT]);
  const same = JSON.stringify(after) === JSON.stringify(formatsBefore);
  const counts = await q(`select type, status, count(*)::int n from "Document" where "organizationId" = $1 and config->'erpImport'->>'batch' = $2 group by 1,2 order by 1,2`, [WCT, BATCH]);
  const journals = (await q(`select count(*)::int n from "JournalEntry" j join "Document" d on d.id::text = j."sourceDocumentId" where d."organizationId" = $1 and d.config->'erpImport'->>'batch' = $2`, [WCT, BATCH]))[0].n;
  console.log(`verify: batch rows ${JSON.stringify(counts)} · journals on imported docs ${journals} · number formats unchanged: ${same}`);
  log.verify = { counts, journals, formatsUnchanged: same };
}

async function rollback(c, q, log, saveLog, formatsBefore) {
  const docs = await q(`select id, type from "Document" where "organizationId" = $1 and config->'erpImport'->>'batch' = $2`, [WCT, BATCH]);
  const ids = docs.map((d) => d.id);
  const custs = await q(`select id, "customerCode", name from "Customer" where "organizationId" = $1 and "externalRef" = $2`, [WCT, `erp-import:${BATCH}`]);
  console.log(`\n=== rollback · batch ${BATCH} · ${log.mode} ===\ndocuments: ${ids.length} · customers created by this batch: ${custs.length} ${JSON.stringify(custs.map((x) => x.customerCode))}`);
  // Refuse when anything was built on top of an imported row since the import.
  const blockers = {
    payments: (await q(`select count(*)::int n from "Payment" where "documentId" = any($1::uuid[])`, [ids]))[0].n,
    journals: (await q(`select count(*)::int n from "JournalEntry" where "sourceDocumentId" = any($1::text[])`, [ids]))[0].n,
    orders: (await q(`select count(*)::int n from "Order" where "sourceQuotationId" = any($1::uuid[])`, [ids]))[0].n,
    deliveries: (await q(`select count(*)::int n from "Delivery" where "documentId" = any($1::uuid[]) or "orderInvoiceId" = any($2::text[])`, [ids, ids]))[0].n,
    deliveryItems: (await q(`select count(*)::int n from "DeliveryItem" where "documentId" = any($1::uuid[])`, [ids]))[0].n,
    otherDocsOnNewCustomers: custs.length
      ? (await q(`select count(*)::int n from "Document" where "organizationId" = $1 and (config->>'customerId') = any($2) and coalesce(config->'erpImport'->>'batch','') <> $3`, [WCT, custs.map((x) => x.id), BATCH]))[0].n
      : 0,
  };
  console.log('blockers (all must be 0):', JSON.stringify(blockers));
  if (Object.values(blockers).some((n) => n !== 0)) throw new Error('rollback refused: something now depends on the imported rows');
  if (!APPLY) { await c.query('ROLLBACK'); await c.end(); return; }
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    await c.query('BEGIN');
    await c.query(`delete from "DocumentEmbedding" where "documentId" = any($1::uuid[])`, [part]).catch(() => {});
    const res = await c.query(`delete from "Document" where id = any($1::uuid[]) and "organizationId" = $2 and config->'erpImport'->>'batch' = $3`, [part, WCT, BATCH]);
    if (res.rowCount !== part.length) { await c.query('ROLLBACK'); throw new Error(`deleted ${res.rowCount}, expected ${part.length}`); }
    await c.query('COMMIT');
    log.writes.push({ op: 'DELETE Document', count: part.length, ids: part });
    saveLog();
  }
  if (custs.length) {
    const res = await c.query(`delete from "Customer" where id = any($1::uuid[]) and "externalRef" = $2`, [custs.map((x) => x.id), `erp-import:${BATCH}`]);
    log.writes.push({ op: 'DELETE Customer', count: res.rowCount, ids: custs.map((x) => x.id) });
  }
  await c.query(
    `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status, "createdAt") values ($1,'SYSTEM','system:wct-erp-import','System creation',$2,'cron','DELETE','documents',$3::jsonb,'SUCCESS',now())`,
    [crypto.randomUUID(), WCT, JSON.stringify({ note: `Rolled back WCT ERP import, batch ${BATCH}`, batch: BATCH, documents: ids.length, customers: custs.length })],
  );
  const after = await q(`select "documentType", pattern, "nextSerial", "lastResetKey", "updatedAt" from "DocumentNumberFormat" where "organizationId" = $1 order by "documentType"`, [WCT]);
  console.log(`rolled back ${ids.length} documents, ${custs.length} customers · number formats unchanged: ${JSON.stringify(after) === JSON.stringify(formatsBefore)}`);
  saveLog();
  await c.end();
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
