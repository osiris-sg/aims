/**
 * Imported orders (WCT group, 2026-11-18): one Order per imported old-ERP
 * quotation that has at least one imported invoice linked to it BY THE OLD
 * ERP ITSELF (src/orders/imported-orders.ts, planImportedOrders):
 *   contract_no      the WCT ERP invoice's contract no. starts with the quotation no.
 *   tracker_quotation_no  the BC Air (WCT Cleaning) tracker's own quotation no. column
 *   line_text        an invoice line "Refer to Quotation (-0xxxxx)"
 * No guessing: no customer / subject / amount matching. A reference to another
 * org's quotation, to a quotation not in AIMS, or from an invoice the ERP
 * cancelled is listed and never linked.
 *
 * Writes (only with --apply): Order rows (number ORD-<quotation no.>, status
 * INVOICED / PAID from the invoices' money, order date = quotation date,
 * customer = the quotation's) with the links in Order.linkedDocuments
 * (invoice, creditNote, imported marker). The imported documents are NEVER
 * written; nothing posts to the GL. One ActionLog row per order
 * (system:wct-imported-orders) and a log file.
 * Idempotent: a quotation that already has an order (any) is skipped, and an
 * insert whose number exists is skipped (on conflict do nothing).
 *
 * The orders stay hidden until features.enableImportedOrders is on for the org.
 * --apply needs the app code that makes imported orders read-only deployed
 * first; pass --deployed to confirm that was checked.
 *
 *   npx ts-node --transpile-only scripts/wct-imported-orders.ts --env prod                       # dry run (read-only session)
 *   npx ts-node --transpile-only scripts/wct-imported-orders.ts --env prod --exclude <orgId>
 *   npx ts-node --transpile-only scripts/wct-imported-orders.ts --env prod --apply --deployed     # NOT without Elroy's go
 *   --erp-links <csv>  invoice_no,erp_quotation_no (the invoice's Quotation No. link read
 *                      read-only from the old ERP, _imports/wct/links/); WCT (S) invoices only; used first.
 * Options: --org <id> (repeatable; default the 4 WCT group orgs), --exclude <id> (repeatable),
 *          --schema <name> (default public; dev per-org DBs: the org schema), --out <dir>, --batch-size <n>.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client, types } from 'pg';
import { IMPORTED_LINK_SOURCE_LABEL, IMPORTED_ORDER_SOURCE, IMPORTED_ORDERS_FLAG, planImportedOrders, type PlanDoc, type PlannedOrder } from '../src/orders/imported-orders';

types.setTypeParser(1114, (s: string) => s);

const GROUP: Record<string, string> = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'WCT Racking',
  '5c700000-0000-4000-8000-5c7000000003': 'YMM Kitchen',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const argv = process.argv.slice(2);
const many = (k: string) => argv.flatMap((a, i) => (a === k && argv[i + 1] ? [argv[i + 1]] : []));
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const env = one('--env', 'dev')!;
const APPLY = argv.includes('--apply');
const SCHEMA = one('--schema', 'public')!;
const ORGS = many('--org').length ? many('--org') : Object.keys(GROUP);
const EXCLUDE = new Set(many('--exclude'));
const BATCH_SIZE = Number(one('--batch-size', '200'));
const OUT = one('--out', path.join(__dirname, `wct-imported-orders.${env}`))!;
const BATCH = 'imported-orders-2026-11-18';
const JOB = 'system:wct-imported-orders';

/** RFC-4180 CSV (quoted fields with commas / newlines) into objects keyed by the header row. */
function readCsv(file: string): Array<Record<string, string>> {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h.trim(), r[k] ?? ''])));
}

const orgName = (id: string) => GROUP[id] ?? id;
const T = (t: string) => `"${SCHEMA}"."${t}"`;
const money = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  if (!/^[a-z_][a-z0-9_]*$/i.test(SCHEMA)) throw new Error('bad --schema');
  if (APPLY && !argv.includes('--deployed')) throw new Error('--apply needs --deployed: the read-only imported-order code must be live first');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const orgs = ORGS.filter((o) => !EXCLUDE.has(o));

  // Imported quotations / invoices / credit notes. Items are reduced to the lines that can carry the ERP's text link.
  const rows = await q(
    `select d.id::text id, d."organizationId" "organizationId", d.type, d.name, d.status::text status, d."createdAt",
            (d.config - 'items' - 'termsAndConditions') config,
            (select string_agg(it->>'description', E'\\n') from jsonb_array_elements(case when jsonb_typeof(d.config->'items') = 'array' then d.config->'items' else '[]'::jsonb end) it
              where (it->>'description') ~* 'refer\\w*\\s+to') ref_text,
            d."documentTemplateId" "templateId"
       from ${T('Document')} d
      where d."organizationId" = any($1) and d.type in ('QUOTATION', 'INVOICE', 'CREDIT_NOTE') and d.config ? 'erpImport'`,
    [orgs],
  );
  const docs: PlanDoc[] = rows.map((r: any) => ({ ...r, config: { ...(r.config || {}), items: r.ref_text ? [{ description: r.ref_text }] : [] } }));
  const templateOf = new Map(rows.map((r: any) => [r.id, r.templateId]));
  const existing = await q(`select id::text id, "organizationId", "orderNumber", "sourceQuotationId"::text "sourceQuotationId" from ${T('Order')} where "organizationId" = any($1)`, [orgs]);
  const withOrder = new Set<string>(existing.map((o: any) => o.sourceQuotationId).filter(Boolean));
  const numbers = new Set<string>(existing.map((o: any) => `${o.organizationId}|${o.orderNumber}`));
  const customers = new Set<string>(
    (await q(`select id::text id, "organizationId" from ${T('Customer')} where "organizationId" = any($1)`, [orgs])).map((x: any) => `${x.organizationId}|${x.id}`),
  );
  const flags = await q(`select "organizationId", features->'${IMPORTED_ORDERS_FLAG}' f from ${T('OrganizationUIConfig')} where "organizationId" = any($1)`, [orgs]);

  // Links are read from ALL group orgs (so a cross-org reference is recognised), orders only for --org minus --exclude.
  // ERP "Quotation No." links pulled read-only from the old ERP (WCT (S) invoices): the FIRST link source.
  const WCT_ORG = '5c700000-0000-4000-8000-5c7000000001';
  const erpLinks = new Map<string, string>();
  const linksFile = one('--erp-links');
  if (linksFile) {
    const rows = readCsv(linksFile);
    const head = Object.keys(rows[0] ?? {});
    const invCol = head.find((h) => h === 'invoice_no') ?? head.find((h) => /invoice/i.test(h));
    const qCol = head.find((h) => h === 'erp_quotation_no') ?? head.find((h) => /quotation_no|quotation/i.test(h) && !/id$/i.test(h));
    if (!invCol || !qCol) throw new Error('--erp-links needs an invoice no. column and a quotation no. column');
    for (const r of rows) if (r[invCol] && r[qCol]) erpLinks.set(`${WCT_ORG}|${r[invCol].trim()}`, r[qCol].trim());
    console.log(`ERP links read: ${erpLinks.size} (${invCol} -> ${qCol})`);
  }
  // WCT ERP credit notes (amounts by invoice no.; WCT invoices carry only the CN number). Applied ones only.
  const creditsByInvoiceNo = new Map<string, number>();
  const cnFile = one('--wct-credit-notes', path.join(process.env.HOME || '', 'Desktop/aims/_imports/wct/erp/wct-credit-notes.csv'))!;
  if (fs.existsSync(cnFile)) {
    for (const r of readCsv(cnFile)) {
      if (r.status !== 'Applied' || !r.invoice_no) continue;
      const k = `${WCT_ORG}|${r.invoice_no.trim()}`;
      creditsByInvoiceNo.set(k, Math.round(((creditsByInvoiceNo.get(k) ?? 0) + (Number(r.total) || 0)) * 100) / 100);
    }
    console.log(`WCT ERP credit notes read: ${creditsByInvoiceNo.size} invoice(s)`);
  }
  const plan = planImportedOrders(docs, { quotationIdsWithOrder: withOrder, exclude: EXCLUDE, erpLinks, creditsByInvoiceNo });
  const clash = plan.orders.filter((o) => numbers.has(`${o.organizationId}|${o.orderNumber}`));
  const todo = plan.orders.filter((o) => !numbers.has(`${o.organizationId}|${o.orderNumber}`));

  // ── Report ────────────────────────────────────────────────────────────────
  const lines: string[] = [];
  const say = (s = '') => {
    lines.push(s);
    console.log(s);
  };
  say(`${env.toUpperCase()} imported orders ${APPLY ? 'APPLY' : 'DRY RUN'} (${new Date().toISOString()})`);
  for (const org of orgs) {
    const mine = todo.filter((o) => o.organizationId === org);
    const invoices = docs.filter((d) => d.organizationId === org && d.type === 'INVOICE');
    const quotes = docs.filter((d) => d.organizationId === org && d.type === 'QUOTATION');
    const linked = mine.flatMap((o) => o.invoices);
    const bySource: Record<string, number> = {};
    for (const l of linked) bySource[IMPORTED_LINK_SOURCE_LABEL[l.source]] = (bySource[IMPORTED_LINK_SOURCE_LABEL[l.source]] ?? 0) + 1;
    const skipped: Record<string, number> = {};
    for (const s of plan.skipped.filter((x) => x.organizationId === org)) {
      const k = s.otherOrg ? `${s.why} (${orgName(s.otherOrg)})` : s.why;
      skipped[k] = (skipped[k] ?? 0) + 1;
    }
    const f = flags.find((x: any) => x.organizationId === org)?.f;
    say('');
    say(`${orgName(org)} (${org}) setting ${IMPORTED_ORDERS_FLAG}=${f === true ? 'on' : 'off'}`);
    say(`  imported quotations ${quotes.length}, imported invoices ${invoices.length}`);
    say(`  orders to create ${mine.length}: one invoice ${mine.filter((o) => o.invoices.length === 1).length}, several invoices ${mine.filter((o) => o.invoices.length > 1).length}`);
    const byLabel: Record<string, number> = {};
    for (const o of mine) byLabel[o.status.label] = (byLabel[o.status.label] ?? 0) + 1;
    say(`  status: ${Object.entries(byLabel).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
    say(`  ERP links that disagree with another source (ERP quotation link kept) ${plan.disagreements.filter((d) => d.organizationId === org).length}`);
    say(`  invoices linked ${linked.length}: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
    say(`  invoices not linked ${invoices.length - linked.length}${Object.keys(skipped).length ? `: ${Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`);
    say(`  credit notes on orders ${mine.reduce((t, o) => t + o.creditNotes.length, 0)}, customer differs from the quotation on ${mine.filter((o) => o.customerMismatch.length).length} order(s), quotation customer not in the org ${mine.filter((o) => o.customerId && !customers.has(`${org}|${o.customerId}`)).length}`);
    say(`  quotations that already have an order (skipped) ${quotes.filter((x) => withOrder.has(x.id)).length}, quotations with no linked invoice (no order) ${quotes.filter((x) => !plan.orders.some((o) => o.quotation.id === x.id) && !withOrder.has(x.id)).length}`);
    say(`  number already taken (skipped) ${clash.filter((o) => o.organizationId === org).length}`);
  }
  say('');
  say('20 samples (order no. | quotation | invoices [source] | customer | quotation total | invoiced | status)');
  const step = Math.max(1, Math.floor(todo.length / 20));
  const sample = todo.filter((_, i) => i % step === 0).slice(0, 20);
  for (const o of sample) {
    say(
      `  ${orgName(o.organizationId)} | ${o.orderNumber} | ${o.quotation.name} | ${o.invoices.map((i) => `${i.doc.name} [${IMPORTED_LINK_SOURCE_LABEL[i.source]}]`).join(', ')} | ${String(o.quotation.config?.customerName ?? '')} | ${money(Number(o.quotation.config?.totalWithTax ?? 0))} | ${money(o.status.billed)} | ${o.status.label}${o.customerMismatch.length ? ' | CUSTOMER DIFFERS' : ''}`,
    );
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.txt'), lines.join('\n') + '\n');
  const csv = (r: any[]) => r.map((x) => x.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
  fs.writeFileSync(
    path.join(OUT, 'orders.csv'),
    csv([['org', 'order', 'quotation', 'quotation date', 'invoices', 'sources', 'status', 'quotation total', 'invoiced', 'billed', 'credited', 'customer differs on'], ...todo.map((o) => [orgName(o.organizationId), o.orderNumber, o.quotation.name, o.date, o.invoices.map((i) => i.doc.name).join(' '), o.invoices.map((i) => i.source).join(' '), o.status.label, o.quoteTotal ?? '', o.total, o.status.billed, o.status.credited, o.customerMismatch.join(' ')])]),
  );
  fs.writeFileSync(path.join(OUT, 'not-linked.csv'), csv([['org', 'invoice', 'why', 'quotation key', 'other org'], ...plan.skipped.map((s) => [orgName(s.organizationId), s.invoice, s.why, s.key ?? '', s.otherOrg ? orgName(s.otherOrg) : ''])]));
  fs.writeFileSync(
    path.join(OUT, 'link-disagreements.csv'),
    csv([['org', 'invoice', 'used (source)', 'other links (source)'], ...plan.disagreements.map((d) => [orgName(d.organizationId), d.invoice, `${d.used.key} (${d.used.source})`, d.others.map((x) => `${x.key} (${x.source})`).join(' ')])]),
  );
  console.log(`\nFiles: ${OUT}`);

  if (!APPLY) {
    console.log(`DRY RUN: ${todo.length} order(s) would be created, nothing written.`);
    await c.end();
    return;
  }

  // ── Apply (batches, one transaction each) ────────────────────────────────
  const log: any[] = [];
  const at = new Date().toISOString();
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const chunk = todo.slice(i, i + BATCH_SIZE);
    await c.query('begin');
    try {
      for (const o of chunk) {
        const r = await insertOrder(c, o, customers, at);
        if (r) {
          await c.query(
            `insert into ${T('ActionLog')}(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
             values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'CREATE', 'order', $3, $4, 'SUCCESS')`,
            [JOB, o.organizationId, r, JSON.stringify({ note: `Imported order ${o.orderNumber}: quotation ${o.quotation.name}, invoices ${o.invoices.map((x) => x.doc.name).join(', ')}`, batch: BATCH })],
          );
          log.push({ id: r, org: o.organizationId, orderNumber: o.orderNumber, quotationId: o.quotation.id, invoiceIds: o.invoices.map((x) => x.doc.id) });
        }
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
    console.log(`  batch ${i / BATCH_SIZE + 1}: ${Math.min(i + BATCH_SIZE, todo.length)}/${todo.length}`);
  }
  fs.writeFileSync(path.join(__dirname, `wct-imported-orders.${env}.log.json`), JSON.stringify({ at, batch: BATCH, created: log }, null, 2));
  console.log(`APPLIED: ${log.length} order(s) created.`);
  await c.end();

  async function insertOrder(cl: Client, o: PlannedOrder, custs: Set<string>, now: string): Promise<string | null> {
    const qc: any = o.quotation.config || {};
    const marker = {
      source: IMPORTED_ORDER_SOURCE,
      batch: BATCH,
      quotationNo: o.quotation.name,
      linkSources: Object.fromEntries(o.invoices.map((i) => [i.doc.id, i.source])),
      erpDoNumbers: o.erpDoNumbers,
      customerMismatch: o.customerMismatch,
      subject: String(qc.subject ?? '').trim() || null,
      site: String(qc.erpImport?.clientSite ?? qc.location ?? '').trim() || null,
      total: o.total,
      quoteTotal: o.quoteTotal,
      credits: o.credits,
      at: now,
    };
    const linked = {
      po: [],
      do: [],
      salesOrder: [],
      invoice: o.invoices.map((i) => ({ id: i.doc.id, name: i.doc.name, templateId: templateOf.get(i.doc.id) ?? null, total: Number(i.doc.config?.totalWithTax ?? 0) || 0 })),
      creditNote: o.creditNotes.map((d) => ({ id: d.id, name: d.name, templateId: templateOf.get(d.id) ?? null })),
      imported: marker,
    };
    const customerId = o.customerId && custs.has(`${o.organizationId}|${o.customerId}`) ? o.customerId : null;
    // Order date = the quotation date (09:00 Singapore).
    const created = o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? `${o.date}T01:00:00.000Z` : now;
    const res = await cl.query(
      `insert into ${T('Order')}(id, "orderNumber", "organizationId", "customerId", "sourceQuotationId", status, items, "linkedDocuments", notes, "createdAt", "updatedAt")
       select gen_random_uuid(), $1, $2, $3::uuid, $4::uuid, $5, '[]'::jsonb, $6::jsonb, $7, $8::timestamp, now()
        where not exists (select 1 from ${T('Order')} where "organizationId" = $2 and "sourceQuotationId" = $4::uuid)
       on conflict ("orderNumber", "organizationId") do nothing
       returning id::text id`,
      [o.orderNumber, o.organizationId, customerId, o.quotation.id, o.status.status, JSON.stringify(linked), `Imported from the old ERP: quotation ${o.quotation.name}`, created],
    );
    return res.rows[0]?.id ?? null;
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
