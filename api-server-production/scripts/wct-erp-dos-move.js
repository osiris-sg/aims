/**
 * WCT old-ERP DOs in the wrong org (2026-11-19, Elroy). An imported ERP DO (Document DELIVERY_ORDER with
 * config.erpImport.source 'wct-erp') belongs to the org of its linked AIMS quotation, else of the imported
 * invoice(s) carrying its DO number; "(NG)" in its ERP subject decides only when there is no link (BC Air,
 * else WCT (S)). The rule is wct-erp-dos.js placeErpDo, so this script and the importer always agree.
 *
 * DRY RUN BY DEFAULT (read-only session):
 *   1. places every imported ERP DO and writes the placement table + summary (--out, default
 *      ~/Desktop/aims-agents/imports/erp-dos-placement.csv / .txt);
 *   2. plans moving each misplaced DO (and each owner decision --move DO0xxxxx=bcair|wct) to its org, by the
 *      importer's own plan (planErpDos): Document.organizationId + documentTemplateId (that org's DO template)
 *      + customer (the quotation's, else the linked invoice's, else by name: reviewed map / exact / normalised)
 *      + issuing company / UEN + quotation and order fields; the DO entry comes off the wrong org's order (a
 *      DO-only order this importer made, left with no DO and no invoice, is removed) and goes onto the right
 *      org's order (the order naming the DO, holding its invoice, or the quotation's imported order), or onto a
 *      new DO-only order there (only when the quotation is in that org), as wct-erp-dos.js would;
 *   3. --apply (prod also --confirm-prod): one transaction under the importer's lock; an ActionLog row in
 *      BOTH orgs per DO and one per order touched; every write with its before-image logged to
 *      <log dir>/wct-erp-dos-move.<env>.<at>.log.json (default <imports>/erp-catchup/<today>/apply-logs).
 * Never touches native DOs, invoices or quotations; no GL, no counters, no DocumentItem rows (imported DOs
 * have none), search embeddings follow the DO.
 *
 *   node scripts/wct-erp-dos-move.js --env prod                                     dry run
 *   node scripts/wct-erp-dos-move.js --env prod --move DO012537=bcair               dry run with a decision
 *   node scripts/wct-erp-dos-move.js --env prod [--move ...] --apply --confirm-prod apply
 *   node scripts/wct-erp-dos-move.js --env prod --rollback --log <apply log> [--apply --confirm-prod]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ORG, ORG_NAME, SOURCE, ORDER_SOURCE, planErpDos, placeErpDo, loadErpSubjects, withDoLinks, newOrderLinked, doNumbersIn, readCsv, writeCsv } = require('./wct-erp-dos');

const JOB = 'system:wct-erp-dos-move';
const ORGS = [ORG.WCT, ORG.BCAIR];

/** The importer's ERP entry rebuilt from an imported DO (planErpDos input), lines from its items. */
function entryOf(d) {
  const c = d.config || {}, e = c.erpImport || {};
  return {
    erp_id: String(e.erpId || ''), do_no: d.name, date: c.date, contract_no: e.quotationNo || '', customer: e.erpCustomer || c.customerName || '', term: e.term || '', engagement_id: e.engagementId || '',
    parsed: { quotation_no: e.quotationNo || '', pdf_date: c.date, sold_to: e.soldTo || '', sold_to_address: '', attention: c.attention?.name || '', attention_phone: c.attention?.phoneNumber || '', ship_to: e.shipTo || '', ship_to_address: '' },
    lines: (Array.isArray(c.items) ? c.items : []).map((it, k) => ({ line_no: String(k + 1), description: it.description || '', qty: String(it.quantity ?? ''), remark: it.remark || '' })),
  };
}

/**
 * The move plan (pure; tested). ctx = the importer's planErpDos ctx without dos/nativeDos, plus
 * importedDos: [{ id, organizationId, name, documentTemplateId, config }], forceOrg: Map<doNo, org>,
 * erpQuoteSubjects / erpInvoiceSubjects, bcTwins: Map<invoiceName, [bcInvoiceName]>, dependents: Map<docId, string[]>,
 * orderDependents: Map<orderId, string[]>.
 * Returns { rows (placement table), moves, held, orderChanges: { removeFrom, deleteOrders }, plan }.
 */
function planMoves(ctx) {
  const quoteByNo = new Map();
  for (const q of ctx.quotations) quoteByNo.set(q.name, [...(quoteByNo.get(q.name) || []), q]);
  const invByDo = new Map();
  for (const inv of ctx.invoices) for (const d of doNumbersIn(inv.config?.erpImport?.ourDoNo)) invByDo.set(d, [...(invByDo.get(d) || []), inv]);
  const forceOrg = ctx.forceOrg || new Map();
  const rows = [], misplaced = [];
  for (const d of ctx.importedDos) {
    const c = d.config || {}, e = c.erpImport || {};
    const qNo = String(e.quotationNo || '').trim();
    const qName = /^-\d+$/.test(qNo) ? `Q${qNo}` : (c.quotationNo || '');
    const qs = quoteByNo.get(qName) || [];
    const quote = qs.length === 1 ? qs[0] : null;
    const invs = invByDo.get(d.name) || [];
    const erpQuoteSubject = ctx.erpQuoteSubjects?.get(qName) || '';
    const erpInvSubjects = (ctx.erpInvoiceSubjects?.get(d.name) || []).map((x) => x.subject);
    const erpSubjects = [erpQuoteSubject, ...erpInvSubjects].filter(Boolean);
    const rule = qs.length > 1 ? { org: null, by: `${qs.length} quotations ${qName}`, ng: false, notes: [] } : placeErpDo({ quote, invoices: invs, erpSubjects });
    const force = forceOrg.get(d.name) || null;
    // An earlier owner decision (a --move apply) stays put unless a new --move says otherwise.
    const kept = !force && e.movedFrom?.reason === 'owner decision' ? d.organizationId : null;
    const target = force || kept || rule.org;
    const cust = (ctx.customersByOrg.get(d.organizationId) || []).find((x) => x.id === c.customerId);
    const flags = [];
    if (quote && quote.organizationId !== d.organizationId) flags.push(`org differs from quotation ${quote.name} (${ORG_NAME[quote.organizationId]})`);
    for (const i of invs) if (i.organizationId !== d.organizationId) flags.push(`org differs from invoice ${i.name} (${ORG_NAME[i.organizationId]})`);
    const ngOrg = rule.ng ? ORG.BCAIR : ORG.WCT;
    if (ngOrg !== d.organizationId) flags.push(`ERP subject ${rule.ng ? 'has' : 'has no'} "(NG)" (implies ${ORG_NAME[ngOrg]})`);
    let status;
    if (!target) status = 'CANNOT PLACE';
    else if (target !== d.organizationId) status = force ? 'MOVE (decision)' : 'MOVE';
    else if (kept) status = 'OK (decision)';
    else if (rule.ng && d.organizationId !== ORG.BCAIR) status = 'REVIEW';
    else status = 'OK';
    const twins = [...new Set(invs.flatMap((i) => ctx.bcTwins?.get(i.name) || []))];
    rows.push({
      do_no: d.name, erp_date: c.date || '', erp_customer: e.erpCustomer || '', current_org: ORG_NAME[d.organizationId] || d.organizationId,
      customer: cust ? `${cust.customerCode || ''} ${cust.name}`.trim() : c.customerId || '', order: c.orderNo || '',
      quotation: qName, quotation_org: qs.map((q) => ORG_NAME[q.organizationId]).join(' / ') || 'not in AIMS', quotation_subject: quote?.config?.subject || erpQuoteSubject,
      invoices: invs.map((i) => `${i.name} ${ORG_NAME[i.organizationId]} ${i.config?.totalWithTax ?? ''}`.trim()).join('; '), invoice_orgs: [...new Set(invs.map((i) => ORG_NAME[i.organizationId]))].join(' / '),
      invoice_subject: invs.map((i) => i.config?.subject || '').find(Boolean) || erpInvSubjects.find(Boolean) || '',
      bcair_twin_invoices: twins.join(' '), ng_in_erp_subject: rule.ng ? 'yes' : 'no', ng_implies: ORG_NAME[ngOrg],
      rule_org: rule.org ? ORG_NAME[rule.org] : '', placed_by: rule.by, decision: force || kept ? ORG_NAME[force || kept] : '', target_org: target ? ORG_NAME[target] : '',
      status, notes: [...flags, ...(target && target !== d.organizationId ? rule.notes : [])].join('; '),
    });
    if (target && target !== d.organizationId) misplaced.push(d);
  }

  // The importer's own plan for the misplaced DOs, in their new org (no look-alike check: already imported).
  const movingIds = new Set(misplaced.map((d) => d.id));
  const takenNames = new Set(ctx.allDos.filter((x) => !movingIds.has(x.id)).map((x) => `${x.organizationId}|${x.name}`));
  const plan = planErpDos({ ...ctx, dos: misplaced.map(entryOf), nativeDos: [], includeDuplicates: true, existingDoErpIds: new Set(), takenNames });
  const byName = new Map(misplaced.map((d) => [d.name, d]));
  const held = plan.held.map((h) => ({ ...h, from: ORG_NAME[byName.get(h.do_no)?.organizationId] }));
  const moves = [];
  for (const p of plan.docs) {
    const d = byName.get(p.name);
    const blockers = ctx.dependents?.get(d.id) || [];
    if (blockers.length) { held.push({ do_no: d.name, reason: `rows depend on it: ${blockers.join(', ')}`, from: ORG_NAME[d.organizationId] }); continue; }
    moves.push({ doc: d, p });
  }
  // Keep the DO's own id, done flag and date on its order entries (the plan made fresh ids).
  const heldNames = new Set(held.map((h) => h.do_no));
  for (const { doc, p } of moves) for (const en of [...plan.links.filter((l) => l.entry.name === doc.name).map((l) => l.entry), ...plan.orders.flatMap((o) => o.dos).filter((x) => x.name === doc.name)]) {
    Object.assign(en, { id: doc.id, done: doc.config?.erpImport?.done !== false, date: doc.config?.date || en.date });
  }
  const links = plan.links.filter((l) => !heldNames.has(l.entry.name));
  const newOrders = plan.orders.map((o) => ({ ...o, dos: o.dos.filter((x) => !heldNames.has(x.name)) })).filter((o) => o.dos.length).map((o) => ({ ...o, status: o.dos.every((x) => x.done) ? 'DO_COMPLETED' : 'DO_DRAFT' }));

  // The wrong org's orders: take the DO entry off; a DO-only order this importer made, left empty, is removed.
  const movedIds = new Set(moves.map((m) => m.doc.id));
  const orderChanges = [];
  for (const o of ctx.orders) {
    const ld = o.linkedDocuments || {};
    const off = (Array.isArray(ld.do) ? ld.do : []).filter((x) => movedIds.has(x?.id));
    if (!off.length) continue;
    const left = ld.do.filter((x) => !movedIds.has(x?.id));
    const doOnly = !!ld.imported?.doOnly && String(ld.imported?.batch || '').startsWith('wct-erp-dos') && ld.imported?.source === ORDER_SOURCE;
    const noInvoice = !(Array.isArray(ld.invoice) && ld.invoice.length);
    const deps = ctx.orderDependents?.get(o.id) || [];
    const remove = doOnly && noInvoice && !left.length && !deps.length;
    orderChanges.push({ order: o, off: off.map((x) => x.id), offNames: off.map((x) => x.name), remove, keepWhy: !remove && doOnly && !left.length ? (noInvoice ? `rows depend on it: ${deps.join(', ')}` : 'it has an invoice now') : '' });
  }
  return { rows, moves, held, links, newOrders, orderChanges, plan };
}

/** linkedDocuments of an order after taking DO entries off (a DO-only order also drops their numbers). */
function withoutDoLinks(ld, ids, names) {
  const next = { ...(ld || {}), do: (Array.isArray(ld?.do) ? ld.do : []).filter((x) => !ids.includes(x?.id)) };
  if (ld?.imported?.doOnly && Array.isArray(ld.imported.erpDoNumbers)) next.imported = { ...ld.imported, erpDoNumbers: ld.imported.erpDoNumbers.filter((n) => !names.includes(n)) };
  return next;
}

/** The DO's config patch for its new org (from the importer's plan doc `p`); keys dropped: orderId/orderNo when unlinked. */
function movePatch(doc, p, at, reason) {
  const c = p.config;
  const patch = {
    customerId: c.customerId, customerCode: c.customerCode, customerName: c.customerName, customer: c.customer,
    company: c.company, gstRegNo: c.gstRegNo,
    sourceDocumentId: c.sourceDocumentId, sourceDocumentType: c.sourceDocumentType, sourceDocumentNumber: c.sourceDocumentNumber, poNo: c.poNo,
    ...(p.order ? { orderId: p.order.id, orderNo: p.order.orderNumber } : {}),
    erpImport: { ...(doc.config?.erpImport || {}), movedFrom: { organizationId: doc.organizationId, templateId: doc.documentTemplateId, customerId: doc.config?.customerId || null, orderId: doc.config?.orderId || null, orderNo: doc.config?.orderNo || null, at, by: JOB, reason } },
  };
  return { patch, drop: p.order ? [] : ['orderId', 'orderNo'] };
}

module.exports = { entryOf, planMoves, withoutDoLinks, movePatch };

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const ENV = one('--env', 'dev');
  const APPLY = argv.includes('--apply');
  const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const IMPORTS = path.join(os.homedir(), 'Desktop/aims/_imports/wct');
  const OUT = one('--out', path.join(os.homedir(), 'Desktop/aims-agents/imports'));
  const LOG_DIR = one('--log-dir', path.join(IMPORTS, 'erp-catchup', TODAY, 'apply-logs'));
  const BATCH = `wct-erp-dos-move-${TODAY}`;
  const forceOrg = new Map();
  for (const m of String(one('--move', '')).split(',').filter(Boolean)) {
    const [doNo, to] = m.split('=');
    const org = { bcair: ORG.BCAIR, wct: ORG.WCT }[String(to || '').toLowerCase()];
    if (!/^DO\d{6}$/.test(doNo || '') || !org) throw new Error(`--move ${m}: use DO0xxxxx=bcair|wct`);
    forceOrg.set(doNo, org);
  }
  (async () => {
    if (!['dev', 'prod'].includes(ENV)) throw new Error('--env dev|prod');
    if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
    const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
    if (!url) throw new Error('database url not set');
    const c = new Client({ connectionString: url });
    await c.connect();
    if (!APPLY) await c.query('SET default_transaction_read_only = on');
    const q = async (sql, p = []) => (await c.query(sql, p)).rows;
    if (argv.includes('--rollback')) return rollback(c, q, one('--log'), APPLY);

    // ── Load (both orgs) ──
    const allDos = await q(`select id::text id, "organizationId" "organizationId", name, "documentTemplateId"::text "documentTemplateId", status::text status, (config - 'logo' - 'stamp') config from "Document" where "organizationId" = any($1) and type in ('DELIVERY_ORDER', 'DO')`, [ORGS]);
    const importedDos = allDos.filter((d) => d.config?.erpImport?.source === SOURCE && d.config?.erpImport?.kind === 'DELIVERY_ORDER').sort((a, b) => a.name.localeCompare(b.name));
    const quotations = await q(`select id::text id, "organizationId" "organizationId", name, (config - 'items' - 'termsAndConditions') config from "Document" where "organizationId" = any($1) and type = 'QUOTATION'`, [ORGS]);
    const invoices = await q(`select id::text id, "organizationId" "organizationId", name, jsonb_build_object('erpImport', config->'erpImport', 'customerId', config->'customerId', 'subject', config->'subject', 'totalWithTax', config->'totalWithTax') config from "Document" where "organizationId" = any($1) and type = 'INVOICE' and config ? 'erpImport' and coalesce(config->'erpImport'->>'ourDoNo', '') <> ''`, [ORGS]);
    const orders = await q(`select id::text id, "organizationId" "organizationId", "orderNumber", status, "sourceQuotationId"::text "sourceQuotationId", "linkedDocuments" from "Order" where "organizationId" = any($1)`, [ORGS]);
    const customersByOrg = new Map();
    for (const x of await q(`select id::text id, "organizationId" "organizationId", name, "customerCode", address from "Customer" where "organizationId" = any($1)`, [ORGS])) customersByOrg.set(x.organizationId, [...(customersByOrg.get(x.organizationId) || []), x]);
    const customerMap = new Map();
    for (const f of [path.join(IMPORTS, 'erp/customer-map.csv'), ...fs.readdirSync(path.join(IMPORTS, 'erp-catchup')).map((d) => path.join(IMPORTS, 'erp-catchup', d, 'import/customer-map.csv'))]) for (const r of readCsv(f)) if (r.erp_customer && r.aims_customer_id) customerMap.set(r.erp_customer, r);
    // DO template + issuing company per org: exactly as wct-erp-dos.js picks them.
    const templates = {}, company = {}, gstRegNo = {};
    for (const org of ORGS) {
      const act = await q(`select a."templateId"::text id, a."isPrimary" from "OrganizationActiveTemplate" a where a."organizationId" = $1 and a.type = 'DELIVERY_ORDER' order by a."isPrimary" desc`, [org]).catch(() => []);
      const own = await q(`select id::text id from "DocumentTemplate" where "organizationId" = $1 and type = 'DELIVERY_ORDER' and "isActive" = true`, [org]);
      templates[org] = act.find((a) => a.isPrimary)?.id || (act.length === 1 ? act[0].id : null) || (own.length === 1 ? own[0].id : null);
      const s = (await q(`select config->'company' company, config->>'gstRegNo' gst from "Document" where "organizationId" = $1 and type in ('DELIVERY_ORDER','INVOICE','QUOTATION') and not (config ? 'erpImport') and config ? 'company' order by (type = 'DELIVERY_ORDER') desc, "createdAt" desc limit 1`, [org]))[0];
      company[org] = s?.company || null;
      gstRegNo[org] = s?.gst || '';
    }
    const { erpQuoteSubjects, erpInvoiceSubjects } = loadErpSubjects(IMPORTS);
    const linkedInvNames = [...new Set(invoices.map((i) => i.name))];
    const bcTwins = new Map();
    for (const r of await q(`select name, config->>'referenceNo' ref from "Document" where "organizationId" = $1 and type = 'INVOICE' and config->>'referenceNo' = any($2)`, [ORG.BCAIR, linkedInvNames])) bcTwins.set(r.ref, [...(bcTwins.get(r.ref) || []), r.name]);
    // Rows that hang on an imported DO / an order (any table with a document / order id column).
    const cols = await q(`select table_name t, column_name col, data_type dt from information_schema.columns where table_schema = 'public' and (column_name ilike '%documentid%' or column_name ilike '%orderid%') and table_name not in ('Document', 'DocumentEmbedding', 'ActionLog')`);
    const ids = importedDos.map((d) => d.id), orderIds = orders.map((o) => o.id);
    const dependents = new Map(), orderDependents = new Map();
    for (const { t, col, dt } of cols) {
      const isOrder = /orderid/i.test(col);
      const want = isOrder ? orderIds : ids;
      const cond = dt === 'ARRAY' ? `"${col}"::text[] && $1::text[]` : dt === 'jsonb' ? null : `"${col}"::text = any($1::text[])`;
      if (!cond) continue;
      const hits = await q(`select ${dt === 'ARRAY' ? `unnest("${col}")::text` : `"${col}"::text`} id, count(*)::int n from "${t}" where ${cond} group by 1`, [want]);
      for (const h of hits) { const m = isOrder ? orderDependents : dependents; if (want.includes(h.id)) m.set(h.id, [...(m.get(h.id) || []), `${t}.${col} ${h.n}`]); }
    }

    const at = new Date().toISOString();
    const r = planMoves({ importedDos, allDos, quotations, invoices, orders, customersByOrg, customerMap, templates, company, gstRegNo, erpQuoteSubjects, erpInvoiceSubjects, forceOrg, bcTwins, dependents, orderDependents, batch: BATCH, now: at, pullDay: TODAY, doneRule: 'dated' });
    for (const doNo of forceOrg.keys()) if (!importedDos.some((d) => d.name === doNo)) throw new Error(`--move ${doNo}: not an imported ERP DO`);

    // ── Report ──
    const L = [];
    const say = (s = '') => { L.push(s); console.log(s); };
    const countBy = (rows, f) => rows.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
    const fmt = (o) => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    say(`WCT imported ERP DOs: org check + move · ${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'} · ${at}`);
    if (!APPLY) say('Nothing was written to AIMS or to the ERP.');
    say('Rule: the org of the linked AIMS quotation, else of the imported invoice(s) carrying the DO number; "(NG)" in the ERP subject (quotation / ERP invoice; the ERP has no DO subject) only when there is no link.');
    say(`\nImported ERP DOs: ${importedDos.length} · now ${fmt(countBy(r.rows, (x) => x.current_org))} · rule ${fmt(countBy(r.rows, (x) => `${x.rule_org} by ${x.placed_by}`))}`);
    say(`Status: ${fmt(countBy(r.rows, (x) => x.status))}${forceOrg.size ? ` · decisions ${[...forceOrg].map(([k, v]) => `${k}=${ORG_NAME[v]}`).join(', ')}` : ''}`);
    for (const x of r.rows.filter((y) => y.status !== 'OK' || y.notes)) say(`  ${x.status.padEnd(8)} ${x.do_no} ${x.erp_date} ${x.current_org} -> ${x.target_org} (${x.decision ? 'decision' : x.placed_by}) · ${x.customer} · ${x.quotation} ${x.quotation_org} · inv ${x.invoices || '-'}${x.bcair_twin_invoices ? ` · BC Air twin ${x.bcair_twin_invoices}` : ''} · ${x.notes}`);
    const held = [];
    for (const f of fs.readdirSync(path.join(IMPORTS, 'erp-catchup')).map((d) => path.join(IMPORTS, 'erp-catchup', d, 'erp-do-held.csv'))) held.push(...readCsv(f));
    say(`Held at import (not in AIMS): ${held.map((h) => `${h.do_no} (${h.customer}, ${h.reason})`).join('; ') || 'none'}`);

    say(`\nMove plan: ${r.moves.length} DO(s) · held ${r.held.length} · orders linked ${r.links.length} · new DO-only orders ${r.newOrders.length} · wrong-org orders: entry removed ${r.orderChanges.filter((o) => !o.remove).length}, order removed ${r.orderChanges.filter((o) => o.remove).length}`);
    for (const { doc, p } of r.moves) {
      const from = r.orderChanges.find((o) => o.off.includes(doc.id));
      say(`  MOVE ${doc.name} ${ORG_NAME[doc.organizationId]} -> ${ORG_NAME[p.organizationId]} · template ${doc.documentTemplateId} -> ${p.templateId} · customer ${(customersByOrg.get(doc.organizationId) || []).find((x) => x.id === doc.config?.customerId)?.customerCode || doc.config?.customerId} -> ${p.customer.customerCode} ${p.customer.name} (from the ${p.custHow}) · order ${doc.config?.orderNo || '-'}${from ? (from.remove ? ' (REMOVED: DO-only, now empty)' : ' (entry removed)') : ''} -> ${p.order ? `${p.order.orderNumber}${p.newOrder ? ' (NEW DO-only)' : ` (${p.linkHow})`}` : 'none'}${p.flags.length ? ` · ${p.flags.join('; ')}` : ''}`);
    }
    for (const o of r.orderChanges) if (o.keepWhy) say(`  KEEP order ${o.order.orderNumber}: DO-only but ${o.keepWhy}`);
    for (const h of r.held) say(`  NEEDS DECISION ${h.do_no} (${h.from}): ${h.reason}`);

    const COLS = ['do_no', 'erp_date', 'erp_customer', 'current_org', 'customer', 'order', 'quotation', 'quotation_org', 'quotation_subject', 'invoices', 'invoice_orgs', 'invoice_subject', 'bcair_twin_invoices', 'ng_in_erp_subject', 'ng_implies', 'rule_org', 'placed_by', 'decision', 'target_org', 'status', 'notes'];
    if (!forceOrg.size && !APPLY) {
      fs.mkdirSync(OUT, { recursive: true });
      writeCsv(path.join(OUT, 'erp-dos-placement.csv'), COLS, r.rows);
      fs.writeFileSync(path.join(OUT, 'erp-dos-placement.txt'), L.join('\n') + '\n');
      say(`\nWrote ${path.join(OUT, 'erp-dos-placement.csv')} + .txt`);
    }
    if (!APPLY) {
      say(`\nAPPLY: node scripts/wct-erp-dos-move.js --env ${ENV}${forceOrg.size ? ` --move ${[...forceOrg].map(([k, v]) => `${k}=${v === ORG.BCAIR ? 'bcair' : 'wct'}`).join(',')}` : ''} --apply${ENV === 'prod' ? ' --confirm-prod' : ''}`);
      await c.end();
      return;
    }

    // ── Apply (one transaction, the importer's lock) ──
    if (r.held.length) throw new Error(`refusing: ${r.held.length} DO(s) need a decision (${r.held.map((h) => h.do_no).join(', ')})`);
    if (!r.moves.length) { say('\nNothing to move.'); await c.end(); return; }
    const log = { at, env: ENV, batch: BATCH, decisions: Object.fromEntries([...forceOrg].map(([k, v]) => [k, v])), documents: [], ordersCreated: [], ordersUpdated: [], ordersDeleted: [], actionLogs: 0 };
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `wct-erp-dos-move.${ENV}.${at.replace(/[:.]/g, '-')}.log.json`);
    const save = () => fs.writeFileSync(logFile, JSON.stringify(log, null, 1));
    const actionLog = async (org, action, resource, resourceId, details) => {
      await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt") values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', $3, $4, $5, $6::jsonb, 'SUCCESS', now())`, [JOB, org, action, resource, resourceId, JSON.stringify({ ...details, batch: BATCH })]);
      log.actionLogs++;
    };
    const formatsBefore = await q(`select "organizationId", "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = any($1) order by 1, 2`, [ORGS]);
    await c.query('BEGIN');
    try {
      if (!(await q(`select pg_try_advisory_xact_lock(hashtext('wct-erp-dos')) ok`))[0].ok) throw new Error('a wct-erp-dos run holds the lock');
      // 1. Wrong-org orders: entry off (row-locked, re-read), empty DO-only orders removed.
      for (const oc of r.orderChanges) {
        const cur = (await q(`select to_jsonb(o) row from "Order" o where id = $1::uuid and "organizationId" = $2 for update`, [oc.order.id, oc.order.organizationId]))[0]?.row;
        if (!cur) throw new Error(`order ${oc.order.orderNumber} is gone: nothing applied`);
        const ld = cur.linkedDocuments || {};
        if (oc.remove) {
          if ((ld.invoice || []).length || (ld.do || []).some((x) => !oc.off.includes(x?.id))) throw new Error(`order ${oc.order.orderNumber} changed since the plan: nothing applied`);
          const del = await c.query(`delete from "Order" where id = $1::uuid and "organizationId" = $2 and ("linkedDocuments"->'imported'->>'doOnly')::boolean`, [oc.order.id, oc.order.organizationId]);
          if (del.rowCount !== 1) throw new Error(`order ${oc.order.orderNumber} not removed: nothing applied`);
          log.ordersDeleted.push({ before: cur });
          await actionLog(oc.order.organizationId, 'DELETE', 'order', oc.order.id, { note: `Imported DO-only order ${oc.order.orderNumber} removed: its ERP DO ${oc.offNames.join(', ')} moved to the right org` });
        } else {
          const next = withoutDoLinks(ld, oc.off, oc.offNames);
          await c.query(`update "Order" set "linkedDocuments" = $3::jsonb, "updatedAt" = now() where id = $1::uuid and "organizationId" = $2`, [oc.order.id, oc.order.organizationId, JSON.stringify(next)]);
          log.ordersUpdated.push({ id: oc.order.id, org: oc.order.organizationId, orderNumber: oc.order.orderNumber, beforeLinked: ld, removed: oc.off });
          await actionLog(oc.order.organizationId, 'UPDATE', 'order', oc.order.id, { note: `Imported order ${oc.order.orderNumber}: ERP DO ${oc.offNames.join(', ')} unlinked (moved to the right org)` });
        }
      }
      // 2. New DO-only orders in the right org (the importer's insert).
      for (const o of r.newOrders) {
        const res = await c.query(
          `insert into "Order"(id, "orderNumber", "organizationId", "customerId", "sourceQuotationId", status, items, "linkedDocuments", notes, "createdAt", "updatedAt")
           select $1::uuid, $2, $3, $4::uuid, $5::uuid, $6, '[]'::jsonb, $7::jsonb, $8, $9::timestamp, now()
            where not exists (select 1 from "Order" where "organizationId" = $3 and "sourceQuotationId" = $5::uuid)
           on conflict ("orderNumber", "organizationId") do nothing returning id::text id`,
          [o.id, o.orderNumber, o.organizationId, o.customerId, o.sourceQuotationId, o.status, JSON.stringify(newOrderLinked(o, BATCH, at)), `Imported from the old ERP: quotation ${o.quotationNo}, DO ${o.dos.map((d) => d.name).join(', ')} (moved from the other org)`, /^\d{4}-\d{2}-\d{2}$/.test(o.quotationDate) ? `${o.quotationDate}T01:00:00.000Z` : at],
        );
        if (!res.rows[0]) throw new Error(`order ${o.orderNumber} could not be created: nothing applied`);
        log.ordersCreated.push({ id: o.id, org: o.organizationId, orderNumber: o.orderNumber, status: o.status, dos: o.dos.map((d) => d.id) });
        await actionLog(o.organizationId, 'CREATE', 'order', o.id, { note: `Imported order ${o.orderNumber} from ERP DO ${o.dos.map((d) => d.name).join(', ')} (quotation ${o.quotationNo}, DO moved from the other org)`, status: o.status });
      }
      // 3. The DOs themselves (imported ERP DOs only, still in their old org).
      for (const { doc, p } of r.moves) {
        const reason = forceOrg.has(doc.name) ? 'owner decision' : `rule: ${p.place.by}`;
        const { patch, drop } = movePatch(doc, p, at, reason);
        const before = (await q(`select "organizationId", "documentTemplateId"::text "documentTemplateId", "listCustomerId", config, "updatedAt"::text "updatedAt" from "Document" where id = $1::uuid for update`, [doc.id]))[0];
        const res = await c.query(
          `update "Document" set "organizationId" = $2, "documentTemplateId" = $3, "listCustomerId" = $4, config = (config - $7::text[]) || $5::jsonb, "updatedAt" = now()
            where id = $1::uuid and "organizationId" = $6 and type = 'DELIVERY_ORDER' and config->'erpImport'->>'source' = '${SOURCE}' and config->'erpImport'->>'kind' = 'DELIVERY_ORDER'`,
          [doc.id, p.organizationId, p.templateId, p.customer.id, JSON.stringify(patch), doc.organizationId, drop],
        );
        if (res.rowCount !== 1) throw new Error(`${doc.name} not moved (changed or not an imported DO): nothing applied`);
        await c.query(`update "DocumentEmbedding" set "organizationId" = $2, "customerId" = $3 where "documentId" = $1::uuid`, [doc.id, p.organizationId, p.customer.id]);
        log.documents.push({ id: doc.id, name: doc.name, from: doc.organizationId, to: p.organizationId, templateId: p.templateId, customerId: p.customer.id, orderId: p.order?.id || null, before });
        const note = `Imported ERP DO ${doc.name} moved ${ORG_NAME[doc.organizationId]} -> ${ORG_NAME[p.organizationId]} (${reason})`;
        await actionLog(doc.organizationId, 'UPDATE', 'document', doc.id, { note, from: doc.organizationId, to: p.organizationId });
        await actionLog(p.organizationId, 'UPDATE', 'document', doc.id, { note, from: doc.organizationId, to: p.organizationId, customerId: p.customer.id, orderNo: p.order?.orderNumber || null });
      }
      // 4. The right org's existing imported orders: DO entries on (row-locked, only the do array changes).
      const byOrder = new Map();
      for (const l of r.links) byOrder.set(l.order.id, { order: l.order, entries: [...(byOrder.get(l.order.id)?.entries || []), l.entry] });
      for (const { order, entries } of byOrder.values()) {
        const cur = (await c.query(`select "linkedDocuments" from "Order" where id = $1::uuid and "organizationId" = $2 and "orderNumber" like 'ORD-Q-%' and "linkedDocuments"->'imported'->>'source' = '${ORDER_SOURCE}' for update`, [order.id, order.organizationId])).rows[0];
        if (!cur) throw new Error(`order ${order.orderNumber} is no longer an imported order: nothing applied`);
        await c.query(`update "Order" set "linkedDocuments" = $3::jsonb, "updatedAt" = now() where id = $1::uuid and "organizationId" = $2`, [order.id, order.organizationId, JSON.stringify(withDoLinks(cur.linkedDocuments, entries))]);
        log.ordersUpdated.push({ id: order.id, org: order.organizationId, orderNumber: order.orderNumber, beforeLinked: cur.linkedDocuments, added: entries.map((e) => e.id) });
        await actionLog(order.organizationId, 'UPDATE', 'order', order.id, { note: `Imported order ${order.orderNumber}: ERP DO ${entries.map((e) => e.name).join(', ')} linked (moved from the other org)` });
      }
      const formatsAfter = await q(`select "organizationId", "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = any($1) order by 1, 2`, [ORGS]);
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
    const v = await q(`select name, "organizationId", config->>'orderNo' "orderNo" from "Document" where id = any($1::uuid[]) order by name`, [log.documents.map((d) => d.id)]);
    say(`\nAPPLIED: ${log.documents.length} DO(s) moved, ${log.ordersCreated.length} order(s) created, ${log.ordersUpdated.length} updated, ${log.ordersDeleted.length} removed, ${log.actionLogs} ActionLog rows · now ${v.map((x) => `${x.name} ${ORG_NAME[x.organizationId]} ${x.orderNo || '-'}`).join('; ')} · log ${logFile}`);
    await c.end();
  })().catch((e) => { console.error('ERROR', e.message); process.exit(1); });

  // Rollback from an apply log: DOs back to their before-image (only while still where the move put them),
  // created orders removed (only while DO-only with no invoice), removed orders restored, order links restored.
  async function rollback(c, q, logPath, apply) {
    if (!logPath || !fs.existsSync(logPath)) throw new Error('--rollback needs --log <apply log>');
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    const docs = await q(`select id::text id, "organizationId" from "Document" where id = any($1::uuid[])`, [log.documents.map((d) => d.id)]);
    const notThere = log.documents.filter((d) => docs.find((x) => x.id === d.id)?.organizationId !== d.to);
    const created = await q(`select id::text id from "Order" where id = any($1::uuid[]) and jsonb_array_length(coalesce("linkedDocuments"->'invoice','[]'::jsonb)) = 0`, [log.ordersCreated.map((o) => o.id)]);
    console.log(`rollback of ${path.basename(logPath)}: ${log.documents.length} DOs, ${log.ordersCreated.length} created / ${log.ordersUpdated.length} updated / ${log.ordersDeleted.length} removed orders · DOs no longer where the move put them: ${notThere.map((d) => d.name).join(', ') || 'none'} · created orders with an invoice now: ${log.ordersCreated.length - created.length}`);
    if (notThere.length || created.length !== log.ordersCreated.length) throw new Error('rollback refused: things changed since the move');
    if (!apply) { await c.end(); return; }
    if (ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
    await c.query('BEGIN');
    try {
      for (const o of [...log.ordersUpdated].reverse()) await c.query(`update "Order" set "linkedDocuments" = $2::jsonb, "updatedAt" = now() where id = $1::uuid`, [o.id, JSON.stringify(o.beforeLinked)]);
      await c.query(`delete from "Order" where id = any($1::uuid[]) and ("linkedDocuments"->'imported'->>'doOnly')::boolean`, [log.ordersCreated.map((o) => o.id)]);
      for (const o of log.ordersDeleted) await c.query(`insert into "Order" select * from jsonb_populate_record(null::"Order", $1::jsonb)`, [JSON.stringify(o.before)]);
      for (const d of log.documents) {
        await c.query(`update "Document" set "organizationId" = $2, "documentTemplateId" = $3, "listCustomerId" = $4, config = $5::jsonb, "updatedAt" = $6::timestamp where id = $1::uuid and "organizationId" = $7`, [d.id, d.before.organizationId, d.before.documentTemplateId, d.before.listCustomerId, JSON.stringify(d.before.config), d.before.updatedAt, d.to]);
        await c.query(`update "DocumentEmbedding" set "organizationId" = $2, "customerId" = $3 where "documentId" = $1::uuid`, [d.id, d.before.organizationId, d.before.config?.customerId || null]);
        for (const org of [d.from, d.to]) await c.query(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt") values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'UNDO', 'document', $3, $4::jsonb, 'SUCCESS', now())`, [JOB, org, d.id, JSON.stringify({ note: `Move of imported ERP DO ${d.name} rolled back (${ORG_NAME[d.to]} -> ${ORG_NAME[d.from]})`, batch: log.batch })]);
      }
      await c.query('COMMIT');
      console.log('rolled back');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
    await c.end();
  }
}
