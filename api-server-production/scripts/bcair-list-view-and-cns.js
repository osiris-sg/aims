/**
 * BC Air (2026-11-12), two steps, each a dry run by default; `--apply` writes (one transaction,
 * logged to scripts/bcair-list-view-and-cns.<step>.log.json); `--rollback [--apply]` undoes it.
 *
 *   list-view  OrganizationUIConfig.features.enableDocumentListView false → true for BC Air and
 *              YMM (the Sales pages show a list instead of opening the newest document). One
 *              ActionLog row per org (System creation).
 *   cns        the tracker credit notes (bcair-sales-summary + wct-nongst-cn-summary) as
 *              CREDIT_NOTE documents: the original CN number, the imported marker
 *              (config.erpImport, source bcair-cn-tracker), linked to their imported invoice
 *              (config.sourceDocumentId / sourceDocumentNumber / sourceDocumentType INVOICE).
 *              NO GL: the credits are already in the GL as the erp-gl CREDIT_NOTE journals and
 *              already inside each invoice's paid-in-previous-system amount, so every CN is
 *              stamped fully applied (outstanding 0) and never touches its invoice. Counters
 *              never touched (BC Air has no number formats).
 *              Owner (2026-11-12): ONLY the credit notes with an amount become documents; the
 *              ones the trackers give no amount for stay a note on their invoice and are listed
 *              in --csv <file> (CN no, invoice no, customer, date) for WCT finance.
 *
 *   DBURL=… node scripts/bcair-list-view-and-cns.js list-view [--apply] [--rollback]
 *   DBURL=… node scripts/bcair-list-view-and-cns.js cns --dir <_imports/wct> [--csv <file>] [--apply] [--rollback]
 */
const { Client, types } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const gb = require('./wct-group-books.js');

types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

const ORG = { WCT: '5c700000-0000-4000-8000-5c7000000001', YMM: '5c700000-0000-4000-8000-5c7000000003', BCAIR: '5c700000-0000-4000-8000-5c7000000004' };
const ORG_NAME = { [ORG.YMM]: 'YMM KITCHEN PTE. LTD.', [ORG.BCAIR]: 'BC AIR PTE. LTD.' };
const FLAG = 'enableDocumentListView';
const BATCH = 'bcair-books-2026-11-06';
const CN_BATCH = 'bcair-cn-2026-11-12';
const CN_TEMPLATE = '9fc42cb3-8f6f-497d-a4ea-97756a66b741'; // BC Air's own "Credit Note" template

const args = process.argv.slice(2);
const CMD = args[0];
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const CSV = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
const LOG = (step) => path.resolve(__dirname, `bcair-list-view-and-cns.${step}.log.json`);
const R2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n) => R2(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function connect() {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  return { c, q: async (sql, p) => (await c.query(sql, p)).rows };
}
function writeLog(step, entry) {
  const f = LOG(step);
  const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  all.push(entry);
  fs.writeFileSync(f, JSON.stringify(all, null, 1));
  console.log(`logged → ${path.relative(process.cwd(), f)}`);
}
const lastApply = (step) => (fs.existsSync(LOG(step)) ? JSON.parse(fs.readFileSync(LOG(step), 'utf8')) : []).filter((e) => e.mode === 'APPLY' && !e.rolledBack).pop();
function markRolledBack(step, at) {
  const all = JSON.parse(fs.readFileSync(LOG(step), 'utf8'));
  for (const e of all) if (e.at === at) e.rolledBack = new Date().toISOString();
  fs.writeFileSync(LOG(step), JSON.stringify(all, null, 1));
}
async function actionLog(c, orgId, action, resource, details) {
  await c.query(
    `INSERT INTO "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status, "createdAt") VALUES ($1,'SYSTEM','system:bcair-list-view-and-cns','System creation',$2,'cron',$3,$4,$5::jsonb,'SUCCESS',now())`,
    [crypto.randomUUID(), orgId, action, resource, JSON.stringify(details)],
  );
}
async function guardOrgs(q, ids) {
  for (const id of ids) {
    const o = (await q(`SELECT name FROM "Organization" WHERE id = $1`, [id]))[0];
    if (o?.name !== ORG_NAME[id]) throw new Error(`org ${id} is "${o?.name}", expected "${ORG_NAME[id]}"`);
  }
}

// ================================================================ list-view

async function stepListView() {
  const { c, q } = await connect();
  const orgs = [ORG.BCAIR, ORG.YMM];
  try {
    await guardOrgs(q, orgs);
    if (ROLLBACK) {
      const e = lastApply('list-view');
      if (!e) throw new Error('no list-view APPLY to roll back');
      for (const o of e.orgs) console.log(`rollback ${ORG_NAME[o.org]}: ${FLAG} → ${JSON.stringify(o.before)}`);
      if (!APPLY) return;
      await c.query('BEGIN');
      for (const o of e.orgs) {
        await c.query(`UPDATE "OrganizationUIConfig" SET features = ${o.before === null ? `features - '${FLAG}'` : `jsonb_set(features, '{${FLAG}}', $2::jsonb)`}, "updatedAt" = now() WHERE "organizationId" = $1`, o.before === null ? [o.org] : [o.org, JSON.stringify(o.before)]);
        await actionLog(c, o.org, 'UPDATE', 'organization-ui-config', { note: `${FLAG} restored to ${JSON.stringify(o.before)} (rollback)`, flag: FLAG, value: o.before });
      }
      await c.query('COMMIT');
      markRolledBack('list-view', e.at);
      console.log('ROLLED BACK');
      return;
    }
    const before = [];
    for (const org of orgs) {
      const row = (await q(`SELECT id, features FROM "OrganizationUIConfig" WHERE "organizationId" = $1`, [org]))[0];
      if (!row) throw new Error(`${ORG_NAME[org]}: no OrganizationUIConfig row`);
      const b = row.features && FLAG in row.features ? row.features[FLAG] : null;
      before.push({ org, before: b });
      console.log(`${ORG_NAME[org]}: ${FLAG} ${JSON.stringify(b)} → true${b === true ? ' (already on)' : ''}`);
    }
    if (!APPLY) return;
    await c.query('BEGIN');
    for (const { org, before: b } of before) {
      if (b === true) continue;
      await c.query(`UPDATE "OrganizationUIConfig" SET features = jsonb_set(COALESCE(features, '{}'::jsonb), '{${FLAG}}', 'true'::jsonb), "updatedAt" = now() WHERE "organizationId" = $1`, [org]);
      await actionLog(c, org, 'UPDATE', 'organization-ui-config', { note: `${FLAG} turned ON (Sales pages show a document list)`, flag: FLAG, before: b, after: true });
    }
    await c.query('COMMIT');
    const after = [];
    for (const org of orgs) after.push((await q(`SELECT features->'${FLAG}' v FROM "OrganizationUIConfig" WHERE "organizationId" = $1`, [org]))[0].v);
    writeLog('list-view', { at: new Date().toISOString(), mode: 'APPLY', orgs: before, after });
    console.log(`APPLIED · now ${after.map((v, i) => `${ORG_NAME[orgs[i]]}=${v}`).join(', ')}`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

// ================================================================ cns

/** BC Air's GL at a glance: journal count / totals, the debtors account 1-9999, open AR on documents. */
async function ledgerPrint(q) {
  const j = (await q(`SELECT count(*)::int n, round(sum("totalDebit")::numeric, 2) dr, round(sum("totalCredit")::numeric, 2) cr, max("updatedAt") last FROM "JournalEntry" WHERE "organizationId" = $1`, [ORG.BCAIR]))[0];
  const l = (await q(`SELECT count(*)::int n FROM "JournalEntryLine" l JOIN "JournalEntry" e ON e.id = l."journalEntryId" WHERE e."organizationId" = $1`, [ORG.BCAIR]))[0];
  const ar = (await q(`SELECT round(sum(l.debit - l.credit)::numeric, 2) bal FROM "JournalEntryLine" l JOIN "JournalEntry" e ON e.id = l."journalEntryId" JOIN "ChartOfAccount" a ON a.id = l."accountId" WHERE e."organizationId" = $1 AND e.status = 'POSTED' AND a.code = '1-9999'`, [ORG.BCAIR]))[0];
  const inv = (await q(`SELECT count(*)::int n, round(sum((config->>'outstandingBalance')::numeric), 2) open FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE'`, [ORG.BCAIR]))[0];
  return { journals: j.n, lines: l.n, dr: j.dr, cr: j.cr, lastJournalUpdate: j.last ? new Date(j.last).toISOString() : null, debtors_1_9999: ar.bal, invoices: inv.n, invoicesOpen: inv.open };
}

async function planCns(q) {
  const wct = await q(`SELECT id, name, config->>'date' date, config->>'customerName' cust, config->>'subject' subject, COALESCE((config->>'totalWithTax')::numeric, 0) total, COALESCE((config->>'gstAmount')::numeric, 0) gst, (config->>'outstandingBalance')::numeric owed, config->'erpImport'->>'status' st FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND config ? 'erpImport'`, [ORG.WCT]);
  const wctDocs = new Map(wct.map((r) => [r.name, r]));
  const wc = await gb.readWctc(wctDocs);
  const bc = await gb.readBcair(wctDocs, wc.rows);
  const invs = await q(`SELECT id, name, config FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE' AND config->'erpImport'->>'batch' = $2`, [ORG.BCAIR, BATCH]);
  const byErp = new Map(invs.map((d) => [d.config.erpImport.erpId, d]));
  // One occurrence per (CN number, invoice); a cell holding two numbers ("CN0081 CN0086") is two CNs.
  const occ = [];
  for (const r of [...bc.rows, ...wc.rows]) {
    const inv = byErp.get(`${r.src}:${r.name}`);
    if (!inv) throw new Error(`${r.src}:${r.name}: imported invoice not found`);
    const list = r.src === 'bcair' ? r.cns : r.cn ? [{ ...r.cn, date: r.cn.date || r.date }] : [];
    for (const cn of list) {
      const nos = String(cn.no).split(/[\s,/]+/).filter(Boolean);
      for (const no of nos) occ.push({ no, src: r.src, row: r.row, amount: nos.length > 1 ? 0 : R2(cn.amount || 0), split: nos.length > 1 ? cn.no : null, date: cn.date || r.date, dateRule: cn.dateRule || (r.src === 'wctc' ? 'invoice date' : cn.why || 'invoice date'), inv, invAmount: r.amount });
    }
  }
  // Same number on several invoices → ONE document, linked to every invoice (the first is its source).
  const byNo = new Map();
  for (const o of occ) { if (!byNo.has(o.no)) byNo.set(o.no, []); byNo.get(o.no).push(o); }
  const existingNames = new Set((await q(`SELECT name FROM "Document" WHERE "organizationId" = $1 AND name IS NOT NULL`, [ORG.BCAIR])).map((r) => r.name));
  const have = new Set((await q(`SELECT config->'erpImport'->>'erpId' e FROM "Document" WHERE "organizationId" = $1 AND config->'erpImport'->>'batch' = $2`, [ORG.BCAIR, CN_BATCH])).map((r) => r.e));
  const custIds = [...new Set(occ.map((o) => o.inv.config.customerId))];
  const customers = new Map((await q(`SELECT id::text id, name, "customerCode" FROM "Customer" WHERE "organizationId" = $1 AND id::text = ANY($2)`, [ORG.BCAIR, custIds])).map((r) => [r.id, r]));
  const org = (await q(`SELECT name, address, "phoneNumber" FROM "Organization" WHERE id = $1`, [ORG.BCAIR]))[0];
  const docs = [];
  const flags = [];
  let already = 0;
  for (const [no, list] of byNo) {
    if (have.has(`cn:${no}`)) { already++; continue; }
    if (existingNames.has(no)) throw new Error(`a document named ${no} already exists in BC Air`);
    const first = list[0];
    const invsOf = [...new Map(list.map((o) => [o.inv.id, o.inv])).values()];
    const custs = [...new Set(invsOf.map((i) => i.config.customerId))];
    if (custs.length > 1) flags.push(`${no}: on invoices of ${custs.length} different customers (${invsOf.map((i) => `${i.name} ${i.config.customerName}`).join(' | ')}); the document takes the first`);
    if (list.length > 1) flags.push(`${no}: number used on ${list.length} tracker rows (${list.map((o) => `${o.src} row ${o.row} → ${o.inv.name}${o.amount ? ` ${money(o.amount)}` : ''}`).join(', ')}): one document, linked to ${invsOf.map((i) => i.name).join(' + ')}`);
    if (first.split) flags.push(`${no}: from the two-number cell "${first.split}" on ${first.inv.name}`);
    const amount = R2(list.reduce((a, o) => a + o.amount, 0));
    const cust = customers.get(first.inv.config.customerId) || { id: first.inv.config.customerId, name: first.inv.config.customerName, customerCode: first.inv.config.customerCode };
    const date = list.map((o) => o.date).sort()[0];
    const lineText = `Credit note on ${invsOf.map((i) => i.name).join(', ')}${amount ? '' : ' (amount not in the tracker)'}`;
    const createdAt = new Date(Math.min(Date.parse(`${date}T09:00:00+08:00`), Date.now() - 3600e3));
    const erpImport = {
      source: 'bcair-cn-tracker',
      batch: CN_BATCH,
      erpId: `cn:${no}`,
      originalNumber: no,
      status: 'Applied',
      balanceAtImport: 0,
      amountKnown: amount > 0.005,
      appliedTo: list.map((o) => ({ invoiceId: o.inv.id, invoice: o.inv.name, amount: o.amount, tracker: o.src === 'bcair' ? 'bcair-sales-summary' : 'wct-nongst-cn-summary', trackerRow: o.row })),
      dateRule: first.dateRule,
      glNote: amount > 0.005 ? 'In the GL as erp-gl journal ERP-CN-' + no + ' (posted 2026-11-06); no GL from this document' : 'No amount: no GL',
      importedAt: new Date().toISOString(),
    };
    const config = {
      date, dueDate: date, documentNumber: no, currency: 'SGD',
      company: { name: ORG_NAME[ORG.BCAIR], address: org.address || '', phoneNumber: org.phoneNumber || '' },
      gstRegNo: '', footerMessage: '',
      customerId: cust.id, customerCode: cust.customerCode || '', customerName: cust.name, customerEmail: '', customerAddress: '', billTo: '',
      attention: { name: '', email: '', phoneNumber: '' }, contact: '',
      subject: lineText, referenceNo: invsOf.map((i) => i.name).join(', '), salesPerson: '', paymentTerms: '', remarks: '', termsAndConditions: '', note: '',
      items: [{ id: 1, itemCode: '', description: lineText, quantity: 1, unitPrice: amount, amount, tax: '0', uom: '', isService: true, revenueTag: 'service', accountCode: first.inv.config.items?.[0]?.accountCode || '', inventoryItemId: '' }],
      grossTotal: amount, discountAmount: 0, subTotal: amount, gstAmount: 0, nettTotal: amount, gstPercent: 0, taxApplicable: 'N', absorbTax: 'N', showTotals: true,
      confirmedAt: createdAt.toISOString(),
      sourceDocumentId: first.inv.id, sourceDocumentType: 'INVOICE', sourceDocumentNumber: first.inv.name,
      erpImport,
      // Money keys as stampDocumentMoney writes them: fully applied, nothing open.
      totalWithTax: amount, xeroGross: amount, outstandingBalance: 0, xeroBalance: 0, paidToDate: amount, xeroAmountPaid: amount,
    };
    docs.push({ id: crypto.randomUUID(), name: no, createdAt, config, amount, date, invoices: invsOf.map((i) => i.name), customer: cust.name, src: [...new Set(list.map((o) => o.src))].join('+'), uses: list.length, occ: list });
  }
  const gl = await q(`SELECT reference, round(sum("totalDebit")::numeric, 2) amt FROM "JournalEntry" WHERE "organizationId" = $1 AND "createdBy" = 'erp-gl:bcair-gl-2026-11-06' AND type = 'CREDIT_NOTE' GROUP BY 1`, [ORG.BCAIR]);
  return { occ, docs, flags, already, gl };
}

async function stepCns() {
  const { c, q } = await connect();
  try {
    await guardOrgs(q, [ORG.BCAIR]);
    if (ROLLBACK) {
      const ids = (await q(`SELECT id FROM "Document" WHERE "organizationId" = $1 AND type = 'CREDIT_NOTE' AND config->'erpImport'->>'batch' = $2`, [ORG.BCAIR, CN_BATCH])).map((r) => r.id);
      const je = ids.length ? (await q(`SELECT count(*)::int n FROM "JournalEntry" WHERE "sourceDocumentId" = ANY($1::text[])`, [ids]))[0].n : 0;
      const pay = ids.length ? (await q(`SELECT count(*)::int n FROM "Payment" WHERE "documentId" = ANY($1::uuid[])`, [ids]))[0].n : 0;
      console.log(`rollback cns: ${ids.length} credit notes · journals on them ${je} · payments on them ${pay}`);
      if (je || pay) throw new Error('rollback refused: something was posted / applied on the imported credit notes');
      if (!APPLY) return;
      await c.query('BEGIN');
      await c.query(`DELETE FROM "DocumentEmbedding" WHERE "documentId" = ANY($1::uuid[])`, [ids]).catch(() => {});
      const d = await c.query(`DELETE FROM "Document" WHERE id = ANY($1::uuid[]) AND "organizationId" = $2 AND config->'erpImport'->>'batch' = $3`, [ids, ORG.BCAIR, CN_BATCH]);
      if (d.rowCount !== ids.length) throw new Error(`deleted ${d.rowCount} of ${ids.length}`);
      await actionLog(c, ORG.BCAIR, 'DELETE', 'documents', { note: 'Rolled back the imported tracker credit notes', batch: CN_BATCH, documents: d.rowCount });
      await c.query('COMMIT');
      const e = lastApply('cns');
      if (e) markRolledBack('cns', e.at);
      console.log(`ROLLED BACK ${d.rowCount} credit notes`);
      return;
    }
    const p = await planCns(q);
    const glBy = new Map(p.gl.map((g) => [g.reference, g.amt]));
    const withAmt = p.docs.filter((d) => d.amount > 0.005);
    const noAmt = p.docs.filter((d) => !(d.amount > 0.005));
    if (CSV) {
      const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const rows = noAmt.flatMap((d) => d.occ.map((o) => [d.name, o.inv.name, o.inv.config.customerName, o.date, o.src === 'bcair' ? 'BC AIR - Full Sales Summary' : 'WCT - NON GST UPDATE & CN SUMMARY', o.row]));
      fs.writeFileSync(CSV, ['CN no,Invoice no,Customer,Date,Tracker,Tracker row', ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n');
      console.log(`CSV: ${noAmt.length} credit notes with no amount (${rows.length} CN / invoice rows) → ${CSV}`);
    }
    console.log(`tracker CN numbers: ${p.occ.length} (credit-note cells → numbers; BC Air tracker ${p.occ.filter((o) => o.src === 'bcair').length}, non-GST tracker ${p.occ.filter((o) => o.src === 'wctc').length})`);
    console.log(`credit notes in the trackers: ${p.docs.length} (already imported ${p.already}) · TO CREATE (with an amount) ${withAmt.length} = ${money(withAmt.reduce((a, d) => a + d.amount, 0))} · skipped, no amount in the tracker ${noAmt.length} (stay a note on their invoice)`);
    console.log(`GL check: erp-gl CREDIT_NOTE journals ${p.gl.length} = ${money(p.gl.reduce((a, g) => a + g.amt, 0))}; every amount matches its journal: ${withAmt.every((d) => Math.abs((glBy.get(d.name) || 0) - d.amount) < 0.005) && withAmt.length === p.gl.length ? 'YES' : 'NO'}`);
    for (const d of withAmt) if (Math.abs((glBy.get(d.name) || 0) - d.amount) >= 0.005) console.log(`  MISMATCH ${d.name} doc ${money(d.amount)} vs GL ${money(glBy.get(d.name) || 0)}`);
    console.table(withAmt.map((d) => ({ cn: d.name, date: d.date, amount: money(d.amount), invoices: d.invoices.join(', '), customer: d.customer.slice(0, 34), tracker: d.src })));
    if (p.flags.length) { console.log('flags:'); for (const f of p.flags) console.log(`  - ${f}`); }
    console.log('Each: type CREDIT_NOTE, status confirmed, template "Credit Note", imported marker (config.erpImport, no badge), outstanding 0 (fully applied), GST 0, linked via sourceDocumentId to its invoice. Invoices, GL, payments and number formats untouched. 1 ActionLog row.');
    if (!APPLY) { console.log('DRY RUN: nothing written'); return; }
    const before = await ledgerPrint(q);
    await c.query('BEGIN');
    for (const d of withAmt) {
      await c.query(`INSERT INTO "Document" (id, "createdAt", "updatedAt", config, "documentTemplateId", type, "organizationId", name, status, "revisionNumber", version) VALUES ($1::uuid, $2::timestamp, $2::timestamp, $3::jsonb, $4, 'CREDIT_NOTE', $5, $6, 'confirmed'::"DocumentStatus", 0, 0)`,
        [d.id, d.createdAt.toISOString(), JSON.stringify(d.config), CN_TEMPLATE, ORG.BCAIR, d.name]);
    }
    const je = (await c.query(`SELECT count(*)::int n FROM "JournalEntry" WHERE "sourceDocumentId" = ANY($1::text[])`, [withAmt.map((d) => d.id)])).rows[0].n;
    if (je) throw new Error(`${je} journals appeared on the new credit notes`);
    await actionLog(c, ORG.BCAIR, 'IMPORT', 'documents', { note: `Imported ${withAmt.length} tracker credit notes with an amount (history only, no GL)`, batch: CN_BATCH, documents: withAmt.length, amount: R2(withAmt.reduce((a, d) => a + d.amount, 0)) });
    await c.query('COMMIT');
    const after = await ledgerPrint(q);
    const glSame = JSON.stringify(before) === JSON.stringify(after);
    writeLog('cns', { at: new Date().toISOString(), mode: 'APPLY', batch: CN_BATCH, documents: withAmt.map((d) => ({ id: d.id, name: d.name, amount: d.amount, invoices: d.invoices })), amount: R2(withAmt.reduce((a, d) => a + d.amount, 0)), skippedNoAmount: noAmt.map((d) => d.name), glBefore: before, glAfter: after, glUnchanged: glSame });
    console.log(`APPLIED ${withAmt.length} credit notes · GL ${glSame ? 'UNCHANGED' : 'CHANGED'}: ${JSON.stringify(after)}`);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
}

const steps = { 'list-view': stepListView, cns: stepCns };
if (!steps[CMD]) { console.error(`usage: node scripts/bcair-list-view-and-cns.js ${Object.keys(steps).join('|')} [--apply] [--rollback]`); process.exit(1); }
steps[CMD]().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
