/**
 * WCT old-ERP DELIVERY ORDERS (2026-11-19). The old ERP (wct.iserviceshub.com) keeps DOs under
 * Contracts > "Delivery Order": list a=list_do (DO no., date, contract no. = the quotation no., customer),
 * and a print per DO (GET m=DO&a=vw_form_add_do&c=_do_print_PDF&do_id=<id>: Sold To / Ship To, attention,
 * quotation number, lines S/No / description / qty / remark). The DO detail form is POST-only, so the
 * print is the source. The ERP has NO DO status and NO signed copy / attachment.
 *
 * Pull (browser, read-only GETs): scripts/wct-erp-catchup/erp-pull.browser.js, __erpDoPull({ from }) or
 * the weekly __erpCatchup({ ..., doFrom }) (node scripts/wct-erp-catchup.js --print-pull prints it).
 * Files land in ~/Downloads (erp-catchup-part-NN.csv with do_kind rows, erp-catchup-do-<id>.pdf).
 *
 * This script (DRY RUN BY DEFAULT, read-only session):
 *   1. merges the DO parts + PDFs from ~/Downloads into <pull>/ (erp-do-list.csv, erp-do-months.csv,
 *      do-pdf/<id>.pdf) and parses the PDFs into erp-do-parsed.csv + erp-do-lines.csv;
 *   2. plans the import: each ERP DO dated in the pull window becomes an imported DO (Document type
 *      DELIVERY_ORDER, the org's DO template, the ERP number kept, config.erpImport, status by --done-rule)
 *      in the org of its linked AIMS quotation, else of the imported invoice(s) carrying its DO number;
 *      only a DO with neither goes by "(NG)" in its ERP subject (BC Air) or else WCT (S) (placeErpDo);
 *      customer = the quotation's, else the invoice's, else the ERP name in that org;
 *   3. links each DO to the imported order of its quotation / invoice (adds to order.linkedDocuments.do only,
 *      read and locked inside the apply transaction; the order's status is never changed), or
 *      creates a DO-only imported order when the quotation has none yet (no invoice yet);
 *   4. lists native AIMS DOs that look like the same DO (held, never touched).
 * Writes (only --apply; prod also --confirm-prod): Document rows (no DocumentItem rows: no stock can move),
 * Order rows / Order.linkedDocuments; one ActionLog row per created / linked order and one per org for
 * the DOs. No GL, no counters, no SiteClock, no emails, no app hooks. Log: <pull>/apply-logs/.
 *
 *   node scripts/wct-erp-dos.js --env prod --from <pull dir>                        dry run
 *   node scripts/wct-erp-dos.js --env prod --from <pull dir> --apply --confirm-prod apply
 *   node scripts/wct-erp-dos.js --env prod --rollback --log <apply log> [--apply --confirm-prod]
 * Options: --from <dir> (default _imports/wct/erp-catchup/<today>), --parts-dir <dir> (default ~/Downloads),
 *   --batch <id> (default wct-erp-dos-<pull folder>), --done-rule dated|invoiced (default dated: the ERP
 *   has no DO status; "dated" = a DO dated on or before the pull day is done, "invoiced" = done only when
 *   an imported invoice carries its DO number), --include-duplicates (import ERP DOs that look like a
 *   native AIMS DO too; default held).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORG = { WCT: '5c700000-0000-4000-8000-5c7000000001', BCAIR: '5c700000-0000-4000-8000-5c7000000004' };
const ORG_NAME = { [ORG.WCT]: 'WCT (S)', [ORG.BCAIR]: 'BC Air' };
const SOURCE = 'wct-erp';
const ORDER_SOURCE = 'erp-import';
const JOB = 'system:wct-erp-dos';
// The importer's createdAt rule (wct-erp-import.js): the document's date 09:00 SGT, never on or after 2026-11-02.
const CREATED_CAP = Date.parse('2026-11-02T00:00:00+08:00');

const R2 = (n) => Math.round(n * 100) / 100;
const num = (s) => { const n = Number(String(s ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const n1 = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[’‘`]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const normName = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '').replace(/(pteltd|privatelimited|ltd|llp)$/, '');
const normLine = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** ERP DO numbers inside a free-text field ("DO012360", "DO 12360 / DO012361"). */
const doNumbersIn = (s) => [...String(s || '').toUpperCase().matchAll(/DO\s*-?\s*(\d{4,})/g)].map((m) => `DO${m[1].padStart(6, '0')}`);
const grossOf = (c) => { for (const k of ['totalWithTax', 'nettTotal', 'xeroGross', 'totalAmount']) { const x = Number(c?.[k]); if (c?.[k] !== undefined && c?.[k] !== null && c?.[k] !== '' && Number.isFinite(x)) return x; } return null; };
const NG = /\(NG\)/i;

/**
 * The org an ERP DO belongs to (Elroy, 19 Nov 2026): the org of its linked AIMS quotation (the DO's contract
 * no.), else of the imported invoice(s) carrying its DO number. Only a DO with no link goes by "(NG)" in its
 * ERP subject (the ERP has no DO subject: its quotation's subject, or an ERP invoice's carrying the DO number):
 * BC Air, else WCT (S). `force` (an owner decision) overrides. Pure; also used by wct-erp-dos-move.js.
 * Returns { org (null = cannot place), by, ng, notes[] }.
 */
function placeErpDo({ quote = null, invoices = [], erpSubjects = [], force = null }) {
  const ng = [quote?.config?.subject, quote?.config?.erpImport?.referenceNo, ...invoices.map((i) => i.config?.subject), ...erpSubjects].some((s) => NG.test(String(s ?? '')));
  const invOrgs = [...new Set(invoices.map((i) => i.organizationId))];
  let org, by;
  if (force) { org = force; by = 'decision'; }
  else if (quote) { org = quote.organizationId; by = 'quotation'; }
  else if (invOrgs.length === 1) { org = invOrgs[0]; by = 'invoice'; }
  else if (invOrgs.length > 1) return { org: null, by: `invoices in ${invOrgs.map((o) => ORG_NAME[o] || o).join(' and ')}`, ng, notes: [] };
  else { org = ng ? ORG.BCAIR : ORG.WCT; by = ng ? '(NG) subject' : 'no link'; }
  const notes = [];
  if (quote && quote.organizationId !== org) notes.push(`quotation ${quote.name} is in ${ORG_NAME[quote.organizationId]}`);
  for (const i of invoices) if (i.organizationId !== org) notes.push(`invoice ${i.name} is in ${ORG_NAME[i.organizationId]}`);
  if (ng && org !== ORG.BCAIR) notes.push(`"(NG)" in the ERP subject, ${ORG_NAME[org]} by the ${by}`);
  if (!ng && org === ORG.BCAIR) notes.push(`no "(NG)" in the ERP subject, BC Air by the ${by}`);
  return { org, by, ng, notes };
}

// ── CSV ──────────────────────────────────────────────────────────────────────
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
const readCsv = (file) => (fs.existsSync(file) ? toObjects(parseCsv(fs.readFileSync(file, 'utf8'))) : []);
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file, cols, rows) => fs.writeFileSync(file, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');

const LIST_COLS = ['erp_id', 'do_no', 'date', 'contract_no', 'engagement_id', 'customer', 'term', 'pulled_at'];
const PARSED_COLS = ['erp_id', 'do_no', 'pdf_do_no', 'quotation_no', 'pdf_date', 'sold_to', 'sold_to_address', 'attention', 'attention_phone', 'ship_to', 'ship_to_address', 'line_count', 'pages', 'parse_issues'];
const LINE_COLS = ['erp_id', 'do_no', 'line_no', 'description', 'qty', 'remark'];

// ── 1. Merge (parts + PDFs from ~/Downloads) ─────────────────────────────────
/** Move the DO part files and PDFs from partsDir into outDir. Returns false when there were none. */
function mergeDoParts(partsDir, outDir) {
  if (!fs.existsSync(partsDir)) return false;
  const csvs = fs.readdirSync(partsDir).filter((f) => /^erp-catchup-part-\d+( \(\d+\))?\.csv$/.test(f)).sort();
  const pdfs = fs.readdirSync(partsDir).filter((f) => /^erp-catchup-do-\d+( \(\d+\))?\.pdf$/.test(f));
  const list = [], months = [], used = [];
  for (const f of csvs) {
    const rows = toObjects(parseCsv(fs.readFileSync(path.join(partsDir, f), 'utf8')));
    if (!rows.length || !rows[0].do_kind) continue;
    for (const r of rows) (r.do_kind === 'do' ? list : months).push(r);
    used.push(f);
  }
  if (!used.length && !pdfs.length) return false;
  fs.mkdirSync(path.join(outDir, 'do-pdf'), { recursive: true });
  // A second pull on the same day replaces the DOs it read again.
  const prior = readCsv(path.join(outDir, 'erp-do-list.csv'));
  const fresh = new Set(list.map((r) => r.erp_id));
  writeCsv(path.join(outDir, 'erp-do-list.csv'), LIST_COLS, [...prior.filter((r) => !fresh.has(r.erp_id)), ...list]);
  if (months.length) writeCsv(path.join(outDir, 'erp-do-months.csv'), ['month', 'count'], months);
  for (const f of pdfs) fs.renameSync(path.join(partsDir, f), path.join(outDir, 'do-pdf', f.replace(/^erp-catchup-do-(\d+).*$/, '$1.pdf')));
  for (const f of used) fs.unlinkSync(path.join(partsDir, f));
  return { list: list.length, months: months.length, pdfs: pdfs.length };
}

// ── PDF parsing (positions from pdfjs; the print is TCPDF A4, one table) ────
async function pdfjs() {
  return import(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.mjs'));
}
/** Parse one ERP DO print. Exported for tests. */
async function parseDoPdf(buf) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const out = { doNo: '', quotationNo: '', date: '', soldTo: '', soldToAddress: [], attention: '', attentionPhone: '', shipTo: '', shipToAddress: [], lines: [], pages: doc.numPages, issues: [] };
  let line = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items = tc.items.filter((i) => String(i.str).trim()).map((i) => ({ x: i.transform[4], y: i.transform[5], s: String(i.str).replace(/\s+/g, ' ').trim() }));
    const hdr = items.find((i) => i.s === 'S/No');
    const col = (name) => items.find((i) => i.s === name && hdr && Math.abs(i.y - hdr.y) < 2);
    const qtyX = col('QTY')?.x ?? 380, remX = col('REMARK')?.x ?? 470, descX = col('DESCRIPTION')?.x ?? 60;
    if (p === 1) {
      const val = (label) => { const l = items.find((i) => i.s === label); if (!l) return ''; const v = items.filter((i) => Math.abs(i.y - l.y) < 2 && i.x > l.x + 5).sort((a, b) => a.x - b.x); return v.map((i) => i.s).join(' '); };
      out.doNo = val('Delivery Oder No') || val('Delivery Order No');
      out.quotationNo = val('Quotation Number');
      const d = /^(\d{2})-(\d{2})-(\d{4})$/.exec(val('Date'));
      out.date = d ? `${d[3]}-${d[2]}-${d[1]}` : val('Date');
      const top = hdr ? hdr.y : 0;
      const block = (label, left) => {
        const l = items.find((i) => i.s === label);
        if (!l) return [];
        return items.filter((i) => (left ? i.x < 300 : i.x >= 300) && i.y < l.y - 1 && i.y > top + 1).sort((a, b) => b.y - a.y || a.x - b.x);
      };
      const sold = block('Sold To:', true);
      const attnAt = sold.findIndex((i) => /^Attention:/.test(i.s));
      const soldLines = (attnAt >= 0 ? sold.slice(0, attnAt) : sold).filter((i) => !/^(Mobile|Tel|Email|Fax):/.test(i.s)).map((i) => i.s);
      out.soldTo = soldLines[0] || '';
      out.soldToAddress = soldLines.slice(1);
      out.attention = (sold.find((i) => /^Attention:/.test(i.s))?.s || '').replace(/^Attention:\s*/, '').trim();
      out.attentionPhone = (sold.find((i) => /^(Mobile|Tel):/.test(i.s))?.s || '').replace(/^(Mobile|Tel):\s*/, '').trim();
      const ship = block('Ship To:', false).map((i) => i.s);
      out.shipTo = ship[0] || '';
      out.shipToAddress = ship.slice(1);
    }
    if (!hdr) { out.issues.push(`page ${p}: no table header`); continue; }
    const rows = items.filter((i) => i.y < hdr.y - 1 && i.y > 12 && !/^Powered by TCPDF/.test(i.s)).sort((a, b) => b.y - a.y || a.x - b.x);
    for (const i of rows) {
      if (i.x < descX - 3 && /^\d+$/.test(i.s)) { line = { no: Number(i.s), y: i.y, desc: [], qty: '', remark: [] }; out.lines.push(line); continue; }
      if (!line) { out.issues.push(`page ${p}: text before the first line: ${i.s.slice(0, 40)}`); continue; }
      if (i.x >= remX - 5) line.remark.push(i.s);
      else if (i.x >= qtyX - 10) { if (line.qty) out.issues.push(`line ${line.no}: two quantities`); line.qty = i.s; }
      else line.desc.push(i.s);
    }
  }
  out.lines = out.lines.map((l) => ({ no: l.no, description: l.desc.join(' ').replace(/\s+/g, ' ').trim(), qty: l.qty, remark: l.remark.join(' ').trim() }));
  out.lines.forEach((l, k) => { if (l.no !== k + 1) out.issues.push(`line numbers not 1..n at ${l.no}`); if (!/^-?[\d,]+(\.\d+)?$/.test(l.qty)) out.issues.push(`line ${l.no}: quantity "${l.qty}"`); });
  if (!out.lines.length) out.issues.push('no lines');
  return out;
}
/** Parse every PDF in <outDir>/do-pdf into erp-do-parsed.csv + erp-do-lines.csv. */
async function parseDoPdfs(outDir) {
  const list = readCsv(path.join(outDir, 'erp-do-list.csv'));
  const parsed = [], lines = [];
  for (const r of list) {
    const f = path.join(outDir, 'do-pdf', `${r.erp_id}.pdf`);
    if (!fs.existsSync(f)) { parsed.push({ erp_id: r.erp_id, do_no: r.do_no, parse_issues: 'no PDF pulled' }); continue; }
    const d = await parseDoPdf(fs.readFileSync(f));
    if (d.doNo !== r.do_no) d.issues.push(`PDF number ${d.doNo} differs from the list ${r.do_no}`);
    parsed.push({ erp_id: r.erp_id, do_no: r.do_no, pdf_do_no: d.doNo, quotation_no: d.quotationNo, pdf_date: d.date, sold_to: d.soldTo, sold_to_address: d.soldToAddress.join('\n'), attention: d.attention, attention_phone: d.attentionPhone, ship_to: d.shipTo, ship_to_address: d.shipToAddress.join('\n'), line_count: d.lines.length, pages: d.pages, parse_issues: d.issues.join('; ') });
    for (const l of d.lines) lines.push({ erp_id: r.erp_id, do_no: r.do_no, line_no: l.no, description: l.description, qty: l.qty, remark: l.remark });
  }
  writeCsv(path.join(outDir, 'erp-do-parsed.csv'), PARSED_COLS, parsed);
  writeCsv(path.join(outDir, 'erp-do-lines.csv'), LINE_COLS, lines);
  return { parsed: parsed.length, lines: lines.length };
}

/** A customer in `pool` (one org) for an ERP customer name: the importer's reviewed map (when its id is in this
 *  org), then one exact name, then one normalised name (the "(NG)" mover's rule). Several hits = no match. */
function customerByName(pool, erpName, customerMap) {
  const m = customerMap?.get(erpName);
  if (m?.aims_customer_id && ['exact', 'ambiguous-picked-by-address'].includes(m.match)) { const c = pool.find((x) => x.id === m.aims_customer_id); if (c) return c; }
  for (const f of [n1, normName]) {
    const hits = pool.filter((c) => f(c.name) && f(c.name) === f(erpName));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * ERP subjects from the pull files (the "(NG)" fallback): quotation subject by number (Q-0xxxxx) and the ERP
 * invoices carrying each DO number. Read from <imports>/erp and every <imports>/erp-catchup/<day> (later wins).
 */
function loadErpSubjects(importsDir) {
  const erpQuoteSubjects = new Map(), byDo = new Map();
  const dirs = [path.join(importsDir, 'erp')];
  const cu = path.join(importsDir, 'erp-catchup');
  if (fs.existsSync(cu)) dirs.push(...fs.readdirSync(cu).sort().map((d) => path.join(cu, d)));
  for (const d of dirs) {
    for (const f of ['wct-quotes-full.csv', 'erp-quotation-list.csv']) {
      for (const r of readCsv(path.join(d, f))) if (/^-\d+$/.test(r.quotation_no || '') && r.subject) erpQuoteSubjects.set(`Q${r.quotation_no}`, r.subject);
    }
    for (const r of readCsv(path.join(d, 'wct-invoices-full.csv'))) {
      for (const dn of doNumbersIn(r.our_do_no)) { if (!byDo.has(dn)) byDo.set(dn, new Map()); byDo.get(dn).set(r.invoice_no, r.subject || ''); }
    }
  }
  const erpInvoiceSubjects = new Map([...byDo].map(([dn, m]) => [dn, [...m].map(([invoice_no, subject]) => ({ invoice_no, subject }))]));
  return { erpQuoteSubjects, erpInvoiceSubjects };
}

// ── 2. Plan (pure; tested by scripts/__tests__/wct-erp-dos.test.js) ──────
/**
 * ctx: { dos: [{ erp_id, do_no, date, contract_no, customer, term, parsed, lines }], quotations, invoices,
 *        orders, nativeDos, customersByOrg: Map<org, customers[]>, customerMap: Map<erpName, row>,
 *        templates: { [org]: templateId }, existingDoErpIds: Set, takenNames: Set('org|name'),
 *        batch, now (ISO), pullDay ('YYYY-MM-DD'), doneRule, includeDuplicates,
 *        erpQuoteSubjects: Map<'Q-0xxxxx', subject>, erpInvoiceSubjects: Map<doNo, [{ invoice_no, subject }]>,
 *        forceOrg: Map<doNo, org> (owner decisions) }
 */
function planErpDos(ctx) {
  const { batch, now, pullDay, doneRule = 'dated', includeDuplicates = false } = ctx;
  const quoteByNo = new Map();
  for (const q of ctx.quotations) quoteByNo.set(q.name, [...(quoteByNo.get(q.name) || []), q]);
  const invByDo = new Map();
  for (const inv of ctx.invoices) for (const d of doNumbersIn(inv.config?.erpImport?.ourDoNo)) invByDo.set(d, [...(invByDo.get(d) || []), inv]);
  const imported = ctx.orders.filter((o) => /^ORD-Q-/.test(o.orderNumber) && o.linkedDocuments?.imported?.source === ORDER_SOURCE);
  const orderByDoNo = new Map(), orderByInvoice = new Map();
  for (const o of imported) {
    for (const d of o.linkedDocuments.imported.erpDoNumbers || []) orderByDoNo.set(d, [...(orderByDoNo.get(d) || []), o]);
    for (const i of o.linkedDocuments.invoice || []) if (i?.id) orderByInvoice.set(i.id, o);
  }
  const orderNumbers = new Set(ctx.orders.map((o) => `${o.organizationId}|${o.orderNumber}`));

  const docs = [], held = [], links = [], newOrders = new Map(), dupes = [];
  for (const e of ctx.dos) {
    const why = (reason, extra = {}) => held.push({ do_no: e.do_no, date: e.date, customer: e.customer, quotation: e.contract_no, reason, ...extra });
    if (ctx.existingDoErpIds.has(String(e.erp_id))) { held.push({ do_no: e.do_no, reason: 'already imported', skip: true }); continue; }
    if (!e.parsed || !e.lines?.length) { why('PDF not read (no lines)'); continue; }
    const qNo = String(e.contract_no || e.parsed.quotation_no || '').trim();
    const flags = [];
    if (e.parsed.quotation_no && e.parsed.quotation_no !== e.contract_no) flags.push(`PDF quotation ${e.parsed.quotation_no} vs list contract ${e.contract_no}`);
    if (e.parsed.pdf_date && e.parsed.pdf_date !== e.date) flags.push(`PDF date ${e.parsed.pdf_date} vs list ${e.date}`);
    // The quotation: the list's contract no. ("-000356"), else the print's quotation no., else the contract's base
    // number (2026-11-20, old DOs: "-000356-3", "-000376 -10", "-000247 - March" = visits under quotation -000356),
    // also "Q-001038" as typed. The first that names exactly one AIMS quotation wins.
    const qCands = [];
    const addQ = (v, how) => {
      const s0 = String(v || '').trim();
      if (/^-\d+$/.test(s0)) qCands.push({ name: `Q${s0}`, how });
      else if (/^Q-\d+$/i.test(s0)) qCands.push({ name: s0.toUpperCase(), how });
    };
    addQ(e.contract_no, 'contract');
    addQ(e.parsed.quotation_no, 'print');
    const base = /^Q?(-\d{3,})\s*[-\s]/i.exec(String(e.contract_no || '').trim());
    if (base) addQ(base[1], 'contract base');
    const qPick = qCands.find((c) => (quoteByNo.get(c.name) || []).length >= 1) || qCands[0] || null;
    const qName = qPick ? qPick.name : null;
    if (qPick && qPick.how !== 'contract' && (quoteByNo.get(qPick.name) || []).length) flags.push(`quotation ${qPick.name} by the ${qPick.how === 'print' ? "print's quotation no." : "contract's base number"}`);
    const qs = qName ? quoteByNo.get(qName) || [] : [];
    let quote = null, customer = null, custHow;
    if (qs.length > 1) { why(`${qs.length} quotations ${qName} in AIMS (${qs.map((q) => ORG_NAME[q.organizationId]).join(', ')})`); continue; }
    if (qs.length === 1) quote = qs[0];
    // Org: the linked quotation's, else the linked invoice's; "(NG)" only when there is no link (placeErpDo).
    const invs = invByDo.get(e.do_no) || [];
    const erpSubjects = [qName && ctx.erpQuoteSubjects?.get(qName), ...(ctx.erpInvoiceSubjects?.get(e.do_no) || []).map((x) => x.subject)].filter(Boolean);
    const place = placeErpDo({ quote, invoices: invs, erpSubjects, force: ctx.forceOrg?.get(e.do_no) || null });
    if (!place.org) { why(`cannot place: ${place.by}`); continue; }
    const org = place.org;
    flags.push(...place.notes);
    if (quote && quote.organizationId !== org) quote = null; // an owner decision put the DO away from its quotation
    const pool = ctx.customersByOrg.get(org) || [];
    if (quote) {
      customer = pool.find((c) => c.id === quote.config?.customerId) || null;
      custHow = 'quotation';
      if (!customer) { why(`quotation ${qName} has no customer in ${ORG_NAME[org]}`); continue; }
      if (NG.test(`${quote.config?.subject ?? ''} ${quote.config?.erpImport?.referenceNo ?? ''}`) && org !== ORG.BCAIR) flags.push(`"(NG)" quotation ${qName} still in WCT (S)`);
    } else {
      // No quotation in this org: the linked invoice's customer, else the importer's reviewed map, then the name.
      const invCust = [...new Set(invs.filter((i) => i.organizationId === org).map((i) => i.config?.customerId).filter(Boolean))];
      if (invCust.length === 1) { customer = pool.find((c) => c.id === invCust[0]) || null; custHow = 'invoice'; }
      if (!customer) { customer = customerByName(pool, e.customer, ctx.customerMap); custHow = 'erp name'; }
      if (!customer) { why(`quotation ${qName || qNo || '(none)'} not in ${ORG_NAME[org]} and customer "${e.customer}" not matched there`); continue; }
      if (!qs.length) flags.push(`quotation ${qName || qNo || '(none)'} not in AIMS`);
    }
    if (custHow === 'quotation' && normName(e.customer) !== normName(customer.name) && n1(e.customer) !== n1(customer.name)) flags.push(`ERP DO customer "${e.customer}" vs quotation customer ${customer.customerCode} "${customer.name}"`);
    const tpl = ctx.templates[org];
    if (!tpl) { why(`no DO template in ${ORG_NAME[org]}`); continue; }
    if (ctx.takenNames.has(`${org}|${e.do_no}`)) { why(`number ${e.do_no} already used in ${ORG_NAME[org]}`); continue; }

    // Native AIMS DO that looks like this one (same customer, and same date or same lines, or same quotation).
    const lineKey = e.lines.map((l) => normLine(l.description)).filter(Boolean).sort().join('|');
    const matches = [];
    for (const n of ctx.nativeDos.filter((x) => x.organizationId === org || x.organizationId === ORG.WCT || x.organizationId === ORG.BCAIR)) {
      const sameCust = n.config?.customerId === customer.id || normName(n.config?.customerName) === normName(customer.name) || normName(n.config?.customerName) === normName(e.customer);
      const nDate = String(n.config?.date || n.createdAtSgt || '').slice(0, 10);
      const sameDate = nDate === e.date;
      const nKey = (Array.isArray(n.config?.items) ? n.config.items : []).map((it) => normLine(it?.description)).filter(Boolean).sort().join('|');
      const sameLines = !!nKey && nKey === lineKey;
      const sameQuote = !!qName && [n.config?.quotationNo, n.config?.sourceDocumentNumber].map((x) => String(x || '').replace(/\(R\d*\)$/, '').trim()).includes(qName);
      // 2026-11-20 (old DOs back to 2017): the same quotation or the same lines count only within 14 days of each
      // other (a maintenance contract repeats its lines and quotation every visit); same customer + same date always.
      const days = nDate && e.date ? Math.abs(Date.parse(`${nDate}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 86_400_000 : Infinity;
      const near = days <= 14;
      const hit = (sameCust && sameDate) || (near && (sameQuote || (sameCust && sameLines)));
      if (hit) matches.push({ native: n.name, nativeId: n.id, status: n.status, date: nDate, by: [sameCust && 'customer', sameDate && 'date', sameLines && 'lines', sameQuote && 'quotation'].filter(Boolean).join(' + ') });
    }
    if (matches.length) {
      dupes.push({ do_no: e.do_no, date: e.date, customer: e.customer, quotation: qName || qNo, matches });
      if (!includeDuplicates) { why(`looks like native ${matches.map((m) => `${m.native} (${m.by})`).join(', ')}`, { duplicate: true }); continue; }
    }

    // Order: the ERP's own links first (an imported order that already names this DO, or holds an invoice
    // carrying this DO number), then the quotation's imported order; else a new DO-only order.
    const byDo = (orderByDoNo.get(e.do_no) || []).filter((o) => o.organizationId === org);
    const byInv = [...new Set(invs.map((i) => orderByInvoice.get(i.id)).filter(Boolean))].filter((o) => o.organizationId === org);
    const byQuote = quote ? (ctx.orders.find((o) => o.sourceQuotationId === quote.id && o.organizationId === org) || null) : null;
    const cands = [...new Map([...byDo, ...byInv].map((o) => [o.id, o])).values()];
    let order = null, linkHow = null, newOrder = null;
    if (cands.length === 1) { order = cands[0]; linkHow = byDo.includes(order) ? 'order erpDoNumbers' : 'invoice ourDoNo'; }
    else if (cands.length > 1 && byQuote && cands.some((o) => o.id === byQuote.id)) {
      // 2026-11-20: named on several orders: the order of the DO's own quotation wins (Elroy: link to its quotation's order).
      order = byQuote;
      linkHow = 'quotation (DO named on several orders)';
      flags.push(`DO also named on ${cands.filter((o) => o.id !== byQuote.id).map((o) => o.orderNumber).join(', ')}`);
    } else if (cands.length > 1) flags.push(`DO on ${cands.length} imported orders (${cands.map((o) => o.orderNumber).join(', ')}): not linked`);
    if (!order && !cands.length && byQuote) {
      if (byQuote.linkedDocuments?.imported?.source === ORDER_SOURCE) { order = byQuote; linkHow = 'quotation'; }
      else flags.push(`quotation ${qName} has a native order ${byQuote.orderNumber}: not linked`);
    }
    if (order && byQuote && byQuote.id !== order.id) flags.push(`linked by ${linkHow} to ${order.orderNumber}, quotation's order is ${byQuote.orderNumber}`);
    if (!order && !cands.length && !byQuote && quote) {
      const orderNumber = `ORD-${quote.name}`;
      newOrder = newOrders.get(quote.id);
      if (!newOrder) {
        if (orderNumbers.has(`${org}|${orderNumber}`)) flags.push(`order number ${orderNumber} already used: no order made`);
        else {
          const qc = quote.config || {};
          newOrder = { id: crypto.randomUUID(), orderNumber, organizationId: org, customerId: customer.id, sourceQuotationId: quote.id, quotationNo: quote.name, quotationDate: String(qc.date || '').slice(0, 10), quoteTotal: grossOf(qc), subject: String(qc.subject ?? '').trim() || null, site: String(qc.erpImport?.clientSite ?? qc.location ?? '').trim() || null, dos: [] };
          newOrders.set(quote.id, newOrder);
        }
      }
      if (newOrder) { order = newOrder; linkHow = 'new DO-only order'; }
    }

    const done = doneRule === 'invoiced' ? invs.length > 0 : e.date <= pullDay;
    const serial = num(e.do_no.replace(/\D/g, ''));
    const createdAt = new Date(Math.min(Date.parse(`${e.date}T09:00:00+08:00`) + (serial % 3600) * 1000, CREATED_CAP - (100000 - serial) * 1000));
    const p = e.parsed;
    const attn = String(p.attention || '').trim();
    const shipAddr = String(p.ship_to_address || '').split('\n').filter(Boolean).join(', ');
    const soldAddr = String(p.sold_to_address || '').split('\n').filter(Boolean).join(', ');
    const id = crypto.randomUUID();
    const config = {
      date: e.date,
      dueDate: e.date,
      documentNumber: e.do_no,
      currency: 'SGD',
      company: ctx.company?.[org] || null,
      gstRegNo: ctx.gstRegNo?.[org] || '',
      customerId: customer.id,
      customerCode: customer.customerCode || '',
      customerName: customer.name,
      customer: { id: customer.id, name: customer.name, customerCode: customer.customerCode || '', address: customer.address || '' },
      customerAddress: soldAddr,
      customerEmail: '',
      billTo: soldAddr,
      deliveryTo: shipAddr,
      location: shipAddr,
      collectFrom: '',
      attention: { name: attn, email: '', phoneNumber: p.attention_phone || '' },
      contact: [attn, p.attention_phone].filter(Boolean).join(' - '),
      quotationNo: qName || qNo || '',
      ...(quote ? { sourceDocumentId: quote.id, sourceDocumentType: 'QUOTATION', sourceDocumentNumber: quote.name, poNo: String(quote.config?.subject ?? '') } : { sourceDocumentId: '', sourceDocumentType: '', sourceDocumentNumber: '', poNo: '' }),
      ...(order ? { orderId: order.id, orderNo: order.orderNumber } : {}),
      referenceNo: '',
      remarks: '',
      note: '',
      projectName: '',
      documentInfo: { projectName: '' },
      showTotals: false,
      items: e.lines.map((l) => ({ id: num(e.erp_id) * 1000 + num(l.line_no), itemCode: '', description: l.description, quantity: num(l.qty), uom: '', ...(l.remark ? { remark: l.remark } : {}), unitPrice: 0, amount: 0, isService: true, revenueTag: 'service', accountCode: '', inventoryItemId: '' })),
      confirmedAt: createdAt.toISOString(),
      erpImport: {
        source: SOURCE,
        batch,
        kind: 'DELIVERY_ORDER',
        erpId: String(e.erp_id),
        originalNumber: e.do_no,
        status: 'Issued', // the ERP has no DO status: every ERP DO is an issued print
        done,
        doneRule,
        erpCustomer: e.customer,
        soldTo: p.sold_to || null,
        shipTo: p.ship_to || null,
        quotationNo: qNo || null,
        engagementId: e.engagement_id || null,
        term: e.term || null,
        lineCount: e.lines.length,
        invoices: invs.map((i) => i.name),
        importedAt: now,
      },
    };
    const doc = { id, organizationId: org, type: 'DELIVERY_ORDER', name: e.do_no, status: done ? 'delivered_installed' : 'confirmed', templateId: tpl, createdAt, config, done, erpDate: e.date, quote, order, linkHow, newOrder: order === newOrder && !!newOrder, invoices: invs, flags, customer, custHow, place };
    docs.push(doc);
    const entry = { id, name: e.do_no, templateId: tpl, imported: true, erpStatus: 'Issued', done, date: e.date };
    if (newOrder && order === newOrder) newOrder.dos.push(entry);
    else if (order) links.push({ order, entry });
  }
  const orders = [...newOrders.values()].map((o) => ({ ...o, status: o.dos.every((d) => d.done) ? 'DO_COMPLETED' : 'DO_DRAFT' }));
  return { docs, held, links, orders, dupes };
}

/** linkedDocuments of a new DO-only order (the shape the app reads). */
function newOrderLinked(o, batch, at) {
  return {
    po: [], salesOrder: [], invoice: [], creditNote: [],
    do: o.dos,
    imported: { source: ORDER_SOURCE, batch, quotationNo: o.quotationNo, linkSources: {}, erpDoNumbers: o.dos.map((d) => d.name), at, quoteTotal: o.quoteTotal, subject: o.subject, site: o.site, credits: {}, doOnly: true },
  };
}
/**
 * linkedDocuments of an existing imported order after adding DO entries: ONLY the `do` array changes (existing
 * entries kept, no repeats); everything else (invoices, the imported marker, its completion mark) is kept as read.
 */
function withDoLinks(ld, entries) {
  const cur = Array.isArray(ld?.do) ? ld.do : [];
  const have = new Set(cur.map((x) => x?.id));
  // A DO the office unlinked from the order in the app (round 19, imported.unlinked) is never linked back.
  const unlinked = new Set((Array.isArray(ld?.imported?.unlinked) ? ld.imported.unlinked : []).map((x) => (typeof x === 'string' ? x : x?.id)));
  const add = entries.filter((e) => !have.has(e.id) && !unlinked.has(e.id));
  return { ...(ld || {}), do: [...cur, ...add] };
}

module.exports = { ORG, ORG_NAME, SOURCE, ORDER_SOURCE, mergeDoParts, parseDoPdf, parseDoPdfs, planErpDos, placeErpDo, customerByName, loadErpSubjects, newOrderLinked, withDoLinks, doNumbersIn, readCsv, writeCsv };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const ENV = one('--env', 'dev');
  const APPLY = argv.includes('--apply');
  const ROLLBACK = argv.includes('--rollback');
  const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const IMPORTS = path.join(os.homedir(), 'Desktop/aims/_imports/wct');
  const FROM = one('--from', path.join(IMPORTS, 'erp-catchup', TODAY));
  const PARTS = one('--parts-dir', path.join(os.homedir(), 'Downloads'));
  const BATCH = one('--batch', `wct-erp-dos-${path.basename(FROM)}`);
  const DONE_RULE = one('--done-rule', 'dated');
  const INCLUDE_DUPES = argv.includes('--include-duplicates');
  (async () => {
    if (!['dev', 'prod'].includes(ENV)) throw new Error('--env dev|prod');
    if (!['dated', 'invoiced'].includes(DONE_RULE)) throw new Error('--done-rule dated|invoiced');
    if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
    const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
    if (!url) throw new Error('database url not set');
    const c = new Client({ connectionString: url });
    await c.connect();
    if (!APPLY) await c.query('SET default_transaction_read_only = on');
    const q = async (sql, p = []) => (await c.query(sql, p)).rows;
    if (ROLLBACK) return rollback(c, q, one('--log'), APPLY);

    if (!argv.includes('--no-merge')) {
      const m = mergeDoParts(PARTS, FROM);
      if (m) console.log(`merged DO parts into ${FROM}: ${m.list} DOs, ${m.months} month counts, ${m.pdfs} PDFs (moved to do-pdf/)`);
    }
    if (!fs.existsSync(path.join(FROM, 'erp-do-list.csv'))) throw new Error(`no DO pull in ${FROM}`);
    const listRows = readCsv(path.join(FROM, 'erp-do-list.csv'));
    const parsedFile = path.join(FROM, 'erp-do-parsed.csv');
    const pdfCount = fs.existsSync(path.join(FROM, 'do-pdf')) ? fs.readdirSync(path.join(FROM, 'do-pdf')).length : 0;
    // --parsed-only (bulk old-DO run, 19 Nov): the prints were parsed and deleted as they arrived (wct-erp-olddos-watch.js); trust the CSVs.
    if (!argv.includes('--parsed-only') && (!fs.existsSync(parsedFile) || readCsv(parsedFile).length !== listRows.length || pdfCount !== readCsv(parsedFile).filter((r) => r.parse_issues !== 'no PDF pulled').length)) {
      const r = await parseDoPdfs(FROM);
      console.log(`parsed ${r.parsed} DO prints (${r.lines} lines)`);
    }
    const parsed = new Map(readCsv(parsedFile).map((r) => [r.erp_id, r]));
    const linesBy = new Map();
    for (const l of readCsv(path.join(FROM, 'erp-do-lines.csv'))) linesBy.set(l.erp_id, [...(linesBy.get(l.erp_id) || []), l]);
    const months = fs.existsSync(path.join(FROM, 'erp-do-months.csv')) ? readCsv(path.join(FROM, 'erp-do-months.csv')) : [];

    const orgs = [ORG.WCT, ORG.BCAIR];
    const quotations = await q(`select id::text id, "organizationId" "organizationId", name, (config - 'items' - 'termsAndConditions') config from "Document" where "organizationId" = any($1) and type = 'QUOTATION'`, [orgs]);
    const invoices = await q(`select id::text id, "organizationId" "organizationId", name, jsonb_build_object('erpImport', config->'erpImport', 'customerId', config->'customerId', 'subject', config->'subject') config from "Document" where "organizationId" = any($1) and type = 'INVOICE' and config ? 'erpImport' and coalesce(config->'erpImport'->>'ourDoNo', '') <> ''`, [orgs]);
    const orders = await q(`select id::text id, "organizationId" "organizationId", "orderNumber", status, "sourceQuotationId"::text "sourceQuotationId", "linkedDocuments" from "Order" where "organizationId" = any($1)`, [orgs]);
    const allDos = await q(`select id::text id, "organizationId" "organizationId", name, status::text status, (config - 'logo' - 'stamp') config, to_char("createdAt" + interval '8 hours', 'YYYY-MM-DD') "createdAtSgt" from "Document" where "organizationId" = any($1) and type in ('DELIVERY_ORDER', 'DO')`, [orgs]);
    // --native-since <date> (default 1 Nov 2026): native AIMS DOs checked for look-alikes; the bulk old-DO run checks all of them.
    const NATIVE_SINCE = one('--native-since', '2026-11-01');
    const nativeDos = allDos.filter((d) => !d.config?.erpImport && String(d.config?.date || d.createdAtSgt) >= NATIVE_SINCE);
    const existingDoErpIds = new Set(allDos.filter((d) => d.config?.erpImport?.source === SOURCE).map((d) => String(d.config.erpImport.erpId)));
    const customersByOrg = new Map();
    for (const x of await q(`select id::text id, "organizationId" "organizationId", name, "customerCode", address from "Customer" where "organizationId" = any($1)`, [orgs])) customersByOrg.set(x.organizationId, [...(customersByOrg.get(x.organizationId) || []), x]);
    const customerMap = new Map();
    for (const f of [path.join(IMPORTS, 'erp/customer-map.csv'), ...fs.readdirSync(path.join(IMPORTS, 'erp-catchup')).map((d) => path.join(IMPORTS, 'erp-catchup', d, 'import/customer-map.csv'))]) for (const r of readCsv(f)) if (r.erp_customer && r.aims_customer_id) customerMap.set(r.erp_customer, r);
    // DO template per org: the activated primary, else the org's own active DELIVERY_ORDER template (exactly one).
    const templates = {};
    for (const org of orgs) {
      const act = await q(`select a."templateId"::text id, a."isPrimary" from "OrganizationActiveTemplate" a where a."organizationId" = $1 and a.type = 'DELIVERY_ORDER' order by a."isPrimary" desc`, [org]).catch(() => []);
      const own = await q(`select id::text id from "DocumentTemplate" where "organizationId" = $1 and type = 'DELIVERY_ORDER' and "isActive" = true`, [org]);
      templates[org] = act.find((a) => a.isPrimary)?.id || (act.length === 1 ? act[0].id : null) || (own.length === 1 ? own[0].id : null);
    }
    const company = {}, gstRegNo = {};
    for (const org of orgs) {
      const s = (await q(`select config->'company' company, config->>'gstRegNo' gst from "Document" where "organizationId" = $1 and type in ('DELIVERY_ORDER','INVOICE','QUOTATION') and not (config ? 'erpImport') and config ? 'company' order by (type = 'DELIVERY_ORDER') desc, "createdAt" desc limit 1`, [org]))[0];
      company[org] = s?.company || null;
      gstRegNo[org] = s?.gst || '';
    }
    const takenNames = new Set(allDos.map((d) => `${d.organizationId}|${d.name}`));
    const pullDay = (listRows.map((r) => String(r.pulled_at || '').slice(0, 10)).sort().pop() || TODAY);
    const dos = listRows.map((r) => ({ ...r, parsed: parsed.get(r.erp_id) || null, lines: (linesBy.get(r.erp_id) || []).sort((a, b) => num(a.line_no) - num(b.line_no)) }));
    const at = new Date().toISOString();
    const { erpQuoteSubjects, erpInvoiceSubjects } = loadErpSubjects(IMPORTS);
    const plan = planErpDos({ dos, quotations, invoices, orders, nativeDos, customersByOrg, customerMap, templates, company, gstRegNo, existingDoErpIds, takenNames, batch: BATCH, now: at, pullDay, doneRule: DONE_RULE, includeDuplicates: INCLUDE_DUPES, erpQuoteSubjects, erpInvoiceSubjects });

    // ── Report ──
    const L = [];
    const say = (s = '') => { L.push(s); console.log(s); };
    const countBy = (rows, f) => rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
    const fmt = (o) => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    say(`WCT old-ERP DELIVERY ORDERS · ${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'} · ${at} · pull ${FROM} · batch ${BATCH}`);
    if (!APPLY) say('Nothing was written to AIMS or to the ERP.');
    say(`ERP: Contracts > Delivery Order (list a=list_do; print m=DO c=_do_print_PDF). No DO status and no signed copy / attachment in the ERP.`);
    const window = listRows.map((r) => r.date).sort();
    say(`\nPulled: ${listRows.length} DOs dated ${window[0] || '-'} .. ${window[window.length - 1] || '-'} · prints read ${[...parsed.values()].filter((r) => r.parse_issues !== 'no PDF pulled').length} · lines ${[...linesBy.values()].reduce((t, x) => t + x.length, 0)} · print issues ${[...parsed.values()].filter((r) => r.parse_issues).length}`);
    for (const r of [...parsed.values()].filter((x) => x.parse_issues)) say(`  ${r.do_no}: ${r.parse_issues}`);
    if (months.length) {
      const byYear = countBy(months.flatMap((m) => Array(1).fill(m)), (m) => m.month.slice(0, 4));
      void byYear;
      const yr = {};
      for (const m of months) yr[m.month.slice(0, 4)] = (yr[m.month.slice(0, 4)] || 0) + num(m.count);
      say(`Earlier months (count only, not pulled): ${months.reduce((t, m) => t + num(m.count), 0)} DOs ${months[0].month} .. ${months[months.length - 1].month} · by year ${fmt(yr)}`);
      say(`  2026: ${months.filter((m) => m.month.startsWith('2026')).map((m) => `${m.month.slice(5)} ${m.count}`).join(', ')}`);
    }
    const skip = plan.held.filter((h) => h.skip), hold = plan.held.filter((h) => !h.skip);
    say(`\nTo import: ${plan.docs.length} · already imported (skipped): ${skip.length} · held: ${hold.length}`);
    for (const org of orgs) {
      const xs = plan.docs.filter((d) => d.organizationId === org);
      say(`  ${ORG_NAME[org]}: ${xs.length} · template ${templates[org] || 'NONE'} · AIMS status ${fmt(countBy(xs, (d) => d.status))} · done (${DONE_RULE}) ${xs.filter((d) => d.done).length}`);
    }
    const alt = plan.docs.filter((d) => d.invoices.length);
    say(`Done rule: "${DONE_RULE}" (the ERP has no status; erpImport.status = "Issued"). Under "invoiced": done ${alt.length}, not done ${plan.docs.length - alt.length}. Under "dated": all ${plan.docs.filter((d) => d.erpDate <= pullDay).length} dated on or before ${pullDay}.`);
    say(`Org (linked quotation, else linked invoice, else "(NG)" in the ERP subject): ${fmt(countBy(plan.docs, (d) => `${ORG_NAME[d.organizationId]} by ${d.place.by}`))}.`);
    say(`Customer: ${fmt(countBy(plan.docs, (d) => `from the ${d.custHow}`))}.`);
    for (const h of hold) say(`  HELD ${h.do_no} (${h.date}, ${h.customer}, ${h.quotation}): ${h.reason}`);
    say(`\nOrders: linked to an existing imported order ${plan.links.length} DO(s) on ${new Set(plan.links.map((l) => l.order.id)).size} order(s) (${fmt(countBy(plan.docs.filter((d) => d.order && !d.newOrder), (d) => d.linkHow))}) · new DO-only imported orders ${plan.orders.length} (${plan.docs.filter((d) => d.newOrder).length} DOs) · unlinked ${plan.docs.filter((d) => !d.order).length}`);
    for (const org of orgs) {
      const os2 = plan.orders.filter((o) => o.organizationId === org);
      say(`  ${ORG_NAME[org]}: linked ${plan.docs.filter((d) => d.organizationId === org && d.order && !d.newOrder).length}, new orders ${os2.length} (${fmt(countBy(os2, (o) => o.status))}), unlinked ${plan.docs.filter((d) => d.organizationId === org && !d.order).length}`);
    }
    for (const o of plan.orders) say(`  NEW ${ORG_NAME[o.organizationId]} ${o.orderNumber} ${o.status} · ${o.dos.map((d) => d.name).join(', ')} · quotation total ${o.quoteTotal ?? '-'} · ${o.subject || ''}`.slice(0, 220));
    for (const d of plan.docs.filter((x) => !x.order)) say(`  UNLINKED ${ORG_NAME[d.organizationId]} ${d.name} (${d.erpDate}, ${d.customer.name}): ${d.flags.join('; ') || 'no order'}`);
    say(`\nFlags (imported, for review): ${plan.docs.filter((d) => d.flags.length).length}`);
    for (const d of plan.docs.filter((x) => x.flags.length && x.order)) say(`  ${d.name}: ${d.flags.join('; ')}`);
    say(`\nNative AIMS DOs since ${NATIVE_SINCE} (both orgs): ${nativeDos.length} (${nativeDos.map((n) => `${n.name} ${n.status}`).join(', ')})`);
    say(`Look-alike ERP DOs (same quotation, or same customer + same date / same lines): ${plan.dupes.length}${INCLUDE_DUPES ? ' (imported anyway: --include-duplicates)' : ' (held; --include-duplicates imports them)'}`);
    for (const x of plan.dupes) say(`  ERP ${x.do_no} (${x.date}, ${x.customer}, ${x.quotation}) ~ ${x.matches.map((m) => `${m.native} ${m.status} ${m.date} [${m.by}]`).join('; ')}`);
    const unmatched = nativeDos.filter((n) => !plan.dupes.some((x) => x.matches.some((m) => m.nativeId === n.id)));
    const custName = (n) => n.config?.customerName || (customersByOrg.get(n.organizationId) || []).find((x) => x.id === n.config?.customerId)?.name || '-';
    say(`Native DOs with no ERP look-alike: ${unmatched.length}`);
    for (const n of unmatched) {
      // Same customer only (other date, other lines): listed for a person to compare, imported as usual.
      const same = plan.docs.filter((d) => d.customer.id === n.config?.customerId || normName(d.customer.name) === normName(custName(n)));
      const nLines = (Array.isArray(n.config?.items) ? n.config.items : []).map((it) => normLine(it?.description)).filter(Boolean);
      say(`  ${n.name} ${n.status} (${custName(n)}, ${n.config?.date || n.createdAtSgt}, ${n.config?.quotationNo || '-'}, ${n.config?.orderNo || '-'}, ${nLines.length} lines, site ${String(n.config?.deliveryTo || '-').slice(0, 50)})${same.length ? ` · same customer in the ERP: ${same.map((d) => `${d.name} ${d.erpDate} ${d.quote?.name || ''} ${d.config.items.filter((it) => nLines.includes(normLine(it.description))).length}/${d.config.items.length} lines shared, site ${String(d.config.deliveryTo).slice(0, 40)}`).join('; ')}` : ' · no ERP DO for this customer'}`);
    }
    say(`\nAttachments: none in the ERP (no signed copies). The ERP's own print of each DO (~1 MB PDF, logo + text) is kept in ${path.join(FROM, 'do-pdf')}; not uploaded.`);
    fs.mkdirSync(FROM, { recursive: true });
    writeCsv(path.join(FROM, 'erp-do-plan.csv'), ['org', 'placed_by', 'do_no', 'date', 'status', 'done', 'customer', 'quotation', 'order', 'link', 'invoices', 'flags'], plan.docs.map((d) => ({ org: ORG_NAME[d.organizationId], placed_by: d.place.by, do_no: d.name, date: d.erpDate, status: d.status, done: d.done, customer: `${d.customer.customerCode} ${d.customer.name}`, quotation: d.quote?.name || '', order: d.order?.orderNumber || '', link: d.linkHow || '', invoices: d.invoices.map((i) => i.name).join(' '), flags: d.flags.join('; ') })));
    writeCsv(path.join(FROM, 'erp-do-held.csv'), ['do_no', 'date', 'customer', 'quotation', 'reason'], hold);

    if (!APPLY) {
      say(`\nAPPLY (after the app guard is deployed): node scripts/wct-erp-dos.js --env ${ENV} --from ${FROM} --apply${ENV === 'prod' ? ' --confirm-prod' : ''}${DONE_RULE !== 'dated' ? ` --done-rule ${DONE_RULE}` : ''}`);
      fs.writeFileSync(path.join(FROM, 'erp-do-dryrun.txt'), L.join('\n') + '\n');
      await c.end();
      return;
    }

    // ── Apply ──
    const lock = (await q(`select pg_try_advisory_lock(hashtext('wct-erp-dos')) ok`))[0].ok;
    if (!lock) throw new Error('another wct-erp-dos run holds the lock');
    const formatsBefore = await q(`select "organizationId", "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = any($1) order by 1, 2`, [orgs]);
    const log = { at, env: ENV, batch: BATCH, from: FROM, doneRule: DONE_RULE, documents: [], ordersCreated: [], ordersLinked: [] };
    const logDir = path.join(FROM, 'apply-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `wct-erp-dos.${ENV}.${at.replace(/[:.]/g, '-')}.log.json`);
    const save = () => fs.writeFileSync(logFile, JSON.stringify(log, null, 1));
    await c.query('BEGIN');
    try {
      for (const o of plan.orders) {
        const res = await c.query(
          `insert into "Order"(id, "orderNumber", "organizationId", "customerId", "sourceQuotationId", status, items, "linkedDocuments", notes, "createdAt", "updatedAt")
           select $1::uuid, $2, $3, $4::uuid, $5::uuid, $6, '[]'::jsonb, $7::jsonb, $8, $9::timestamp, now()
            where not exists (select 1 from "Order" where "organizationId" = $3 and "sourceQuotationId" = $5::uuid)
           on conflict ("orderNumber", "organizationId") do nothing returning id::text id`,
          [o.id, o.orderNumber, o.organizationId, o.customerId, o.sourceQuotationId, o.status, JSON.stringify(newOrderLinked(o, BATCH, at)), `Imported from the old ERP: quotation ${o.quotationNo}, DO ${o.dos.map((d) => d.name).join(', ')}`, /^\d{4}-\d{2}-\d{2}$/.test(o.quotationDate) ? `${o.quotationDate}T01:00:00.000Z` : at],
        );
        if (!res.rows[0]) throw new Error(`order ${o.orderNumber} could not be created (number or quotation already has an order): nothing applied`);
        await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt") values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'CREATE', 'order', $3, $4::jsonb, 'SUCCESS', now())`,
          [JOB, o.organizationId, o.id, JSON.stringify({ note: `Imported order ${o.orderNumber} from ERP DO ${o.dos.map((d) => d.name).join(', ')} (quotation ${o.quotationNo}, no invoice yet)`, batch: BATCH, status: o.status })]);
        log.ordersCreated.push({ id: o.id, org: o.organizationId, orderNumber: o.orderNumber, status: o.status, dos: o.dos.map((d) => d.id) });
      }
      for (const d of plan.docs) {
        await c.query(
          `insert into "Document" (id, "createdAt", "updatedAt", config, "documentTemplateId", type, "organizationId", name, status, "revisionNumber", version)
           values ($1::uuid, ($2::timestamptz AT TIME ZONE 'UTC'), ($2::timestamptz AT TIME ZONE 'UTC'), $3::jsonb, $4, 'DELIVERY_ORDER', $5, $6, $7::"DocumentStatus", 0, 0)`,
          [d.id, d.createdAt.toISOString(), JSON.stringify(d.config), d.templateId, d.organizationId, d.name, d.status],
        );
        log.documents.push({ id: d.id, org: d.organizationId, name: d.name, status: d.status, orderId: d.order?.id || null });
      }
      const byOrder = new Map();
      for (const l of plan.links) byOrder.set(l.order.id, { order: l.order, entries: [...(byOrder.get(l.order.id)?.entries || []), l.entry] });
      for (const { order, entries } of byOrder.values()) {
        // The order's CURRENT links, read and locked in this transaction (other runs may have changed the
        // marker / status since the plan); only the `do` array is merged, the status is never touched.
        const cur = (await c.query(`select "linkedDocuments" from "Order" where id = $1::uuid and "organizationId" = $2 and "orderNumber" like 'ORD-Q-%' and "linkedDocuments"->'imported'->>'source' = '${ORDER_SOURCE}' for update`, [order.id, order.organizationId])).rows[0];
        if (!cur) throw new Error(`order ${order.orderNumber} is no longer an imported order: nothing applied`);
        const next = withDoLinks(cur.linkedDocuments, entries);
        const res = await c.query(`update "Order" set "linkedDocuments" = $3::jsonb, "updatedAt" = now() where id = $1::uuid and "organizationId" = $2`, [order.id, order.organizationId, JSON.stringify(next)]);
        if (res.rowCount !== 1) throw new Error(`order ${order.orderNumber} not updated: nothing applied`);
        await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt") values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'UPDATE', 'order', $3, $4::jsonb, 'SUCCESS', now())`,
          [JOB, order.organizationId, order.id, JSON.stringify({ note: `Imported order ${order.orderNumber}: ERP DO ${entries.map((e) => e.name).join(', ')} linked`, batch: BATCH })]);
        log.ordersLinked.push({ id: order.id, orderNumber: order.orderNumber, added: entries.map((e) => e.id).filter((id) => !(cur.linkedDocuments?.do || []).some((x) => x?.id === id)) });
      }
      for (const org of orgs) {
        const n = plan.docs.filter((d) => d.organizationId === org).length;
        if (n) await c.query(`insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status, "createdAt") values (gen_random_uuid(),'SYSTEM',$1,'System creation',$2,'operator','IMPORT','documents',$3::jsonb,'SUCCESS',now())`,
          [JOB, org, JSON.stringify({ note: `Imported ${n} old-ERP delivery orders, batch ${BATCH}`, batch: BATCH, documents: n })]);
      }
      const formatsAfter = await q(`select "organizationId", "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = any($1) order by 1, 2`, [orgs]);
      if (JSON.stringify(formatsAfter) !== JSON.stringify(formatsBefore)) throw new Error('number formats changed during the run: nothing applied');
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      log.error = e.message;
      save();
      throw e;
    }
    log.finishedAt = new Date().toISOString();
    save();
    const v = await q(`select "organizationId", status::text, count(*)::int n from "Document" where config->'erpImport'->>'batch' = $1 and type = 'DELIVERY_ORDER' group by 1, 2`, [BATCH]);
    const items = (await q(`select count(*)::int n from "DocumentItem" di join "Document" d on d.id = di."documentId" where d.config->'erpImport'->>'batch' = $1`, [BATCH]))[0].n;
    say(`\nAPPLIED: ${log.documents.length} DOs, ${log.ordersCreated.length} orders created, ${log.ordersLinked.length} orders linked · verify ${JSON.stringify(v)} · DocumentItem rows ${items} · number formats unchanged · log ${logFile}`);
    await c.query(`select pg_advisory_unlock(hashtext('wct-erp-dos'))`).catch(() => {});
    await c.end();
  })().catch((e) => { console.error('ERROR', e.message); process.exit(1); });

  // Rollback from an apply log: remove the DO entries from linked orders, delete the DO-only orders this run
  // created (only while they still have no invoice) and the DOs (only while nothing hangs on them).
  async function rollback(c, q, logPath, apply) {
    if (!logPath || !fs.existsSync(logPath)) throw new Error('--rollback needs --log <apply log>');
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const ids = log.documents.map((d) => d.id);
    const blockers = {
      deliveryItems: (await q(`select count(*)::int n from "DeliveryItem" where "documentId" = any($1::uuid[])`, [ids]))[0].n,
      documentItems: (await q(`select count(*)::int n from "DocumentItem" where "documentId" = any($1::uuid[])`, [ids]))[0].n,
      shareLinks: (await q(`select count(*)::int n from "DocumentShareLink" where "documentId" = any($1::uuid[])`, [ids]))[0].n,
      journals: (await q(`select count(*)::int n from "JournalEntry" where "sourceDocumentId" = any($1::text[])`, [ids]))[0].n,
      ordersWithInvoice: (await q(`select count(*)::int n from "Order" where id = any($1::uuid[]) and jsonb_array_length(coalesce("linkedDocuments"->'invoice','[]'::jsonb)) > 0`, [log.ordersCreated.map((o) => o.id)]))[0].n,
    };
    console.log(`rollback of ${log.batch}: ${ids.length} DOs, ${log.ordersCreated.length} created orders, ${log.ordersLinked.length} linked orders · blockers (all must be 0) ${JSON.stringify(blockers)}`);
    if (Object.values(blockers).some((n) => n)) throw new Error('rollback refused: something now depends on the imported DOs');
    if (!apply) { await c.end(); return; }
    if (process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'prod' && !process.argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
    await c.query('BEGIN');
    try {
      for (const l of log.ordersLinked) {
        const o = (await q(`select "linkedDocuments" from "Order" where id = $1::uuid for update`, [l.id]))[0];
        if (!o) continue;
        const ld = o.linkedDocuments || {};
        const next = { ...ld, do: (ld.do || []).filter((x) => !l.added.includes(x?.id)) };
        await c.query(`update "Order" set "linkedDocuments" = $2::jsonb, "updatedAt" = now() where id = $1::uuid`, [l.id, JSON.stringify(next)]);
      }
      const delO = await c.query(`delete from "Order" where id = any($1::uuid[]) and "linkedDocuments"->'imported'->>'batch' = $2 and ("linkedDocuments"->'imported'->>'doOnly')::boolean`, [log.ordersCreated.map((o) => o.id), log.batch]);
      const delD = await c.query(`delete from "Document" where id = any($1::uuid[]) and type = 'DELIVERY_ORDER' and config->'erpImport'->>'batch' = $2`, [ids, log.batch]);
      if (delD.rowCount !== ids.length) throw new Error(`deleted ${delD.rowCount} DOs, expected ${ids.length}`);
      await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status, "createdAt") values (gen_random_uuid(),'SYSTEM',$1,'System creation',$2,'operator','DELETE','documents',$3::jsonb,'SUCCESS',now())`,
        [JOB, ORG.WCT, JSON.stringify({ note: `Rolled back old-ERP DO import ${log.batch}`, documents: delD.rowCount, orders: delO.rowCount })]);
      await c.query('COMMIT');
      console.log(`rolled back: ${delD.rowCount} DOs, ${delO.rowCount} orders deleted, ${log.ordersLinked.length} orders unlinked`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
    await c.end();
  }
}
