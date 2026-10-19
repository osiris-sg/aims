/**
 * Chong Aik International — purchase history import from the legacy
 * "DETAILED STOCK ANALYSIS BY SUPPLIER" report (STOCK_DETAILS 2.xlsx).
 *
 * The sheet is 5 years of supplier-invoice LINES (Jan 2021 → Oct 2025):
 *   Reference | Date | Supplier | Supplier Name | Stock Code | Description |
 *   Quantity | Uom | Category (= brand) | Cost (unit, SGD) | Total Cost
 *
 * What lands, and where (guru 2026-10-16 "learn the inventory, accounting,
 * and put this data in properly"):
 *   1. Supplier       — one per legacy supplier code (SN028 …), name cleaned,
 *                       billing currency parsed from the "(JPY)" suffix.
 *   2. Category       — one per brand (HONDA, YAMAHA, SHOEI …).
 *   3. Asset          — the ITEM MASTER: one per stock code. name/description =
 *                       latest description, category = latest brand, uom from
 *                       the sheet, costPrice = LAST BUY PRICE (latest line).
 *                       isTracked=false (parts are counted, not serialised),
 *                       quantity NULL — on-hand stock is ported separately.
 *   4. Bill           — one Document(type=BILL) per (reference, supplier) with
 *                       every sheet row as a line, exactly like Biofuel's
 *                       migrated AP history: historical, fully PAID, NO native
 *                       journal (the GL is ported separately — posting these
 *                       would double-count against it). Money stamped through
 *                       stampDocumentMoney(); currency SGD (the report's costs
 *                       are landed SGD costs); NO_TAX (the report carries no
 *                       GST — the ported GL has the real tax).
 *   5. DocumentItem   — one per bill line (itemType ASSET → the Asset), so each
 *                       item's purchase history is queryable by assetId.
 *   NOT written: journals, stock quantities, payments, AP balances.
 *
 *   npx ts-node --transpile-only scripts/import-chongaik-stock-details.ts            # dry run (prod)
 *   npx ts-node --transpile-only scripts/import-chongaik-stock-details.ts --apply    # write
 *   --env dev|prod|staging   --file <xlsx>   --stage suppliers|items|bills|all   --limit <n bills>
 *   (dev = per-org tenancy layout: org rows → org_chongaik, template → platform)
 *
 * Idempotent: suppliers by supplierCode, categories by name, assets by skuKey,
 * bills by config.legacyKey ("<supplierCode>|<reference>"). Re-runs only add
 * what is missing. Every write is scoped to ORG_ID (assertOrgOnly).
 */
import * as path from 'path';
import { randomUUID } from 'crypto';
import { stampDocumentMoney } from '../src/common/document-money';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'prod') || 'prod') as Env;
const APPLY = args.includes('--apply');
const STAGE = (argVal('--stage', 'all') || 'all') as 'suppliers' | 'items' | 'bills' | 'all';
const LIMIT = Number(argVal('--limit', '0')) || 0;
const FILE = argVal('--file', path.join(process.env.HOME || '', 'Downloads', 'STOCK_DETAILS 2.xlsx'))!;
if (!['dev', 'staging', 'prod'].includes(ENV)) {
  console.error('❌ --env dev|staging|prod');
  process.exit(1);
}
loadEnv(ENV);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx');
// dev = per-org tenancy (platform + org_chongaik), prod/staging = public. `p`
// is the org client (Supplier/Category/Asset/Document/DocumentItem); `plat`
// holds Organization + DocumentTemplate.
const { plat, org: p, layout, disconnect } = clientsFor(ENV, 'org_chongaik');

export const ORG_ID = 'ca100000-0000-4000-8000-ca1000000001';
const ORG_NAME = 'Chong Aik International';
const SOURCE_LABEL = 'STOCK_DETAILS 2.xlsx — DETAILED STOCK ANALYSIS BY SUPPLIER';
const R = (n: number) => Math.round(n * 100) / 100;

// ── sheet parsing ───────────────────────────────────────────────────────────
type Row = {
  reference: string;
  date: Date;
  supplierCode: string;
  supplierName: string; // raw, with "(JPY)" suffix
  stockCode: string;
  description: string;
  quantity: number;
  uom: string;
  category: string;
  cost: number;
  total: number;
  idx: number; // sheet order, used as a tiebreak for "latest"
};

const CURRENCY_MAP: Record<string, string> = {
  JPY: 'JPY', JY: 'JPY', THB: 'THB', USD: 'USD', IDR: 'IDR', IDN: 'IDR', SGD: 'SGD', INR: 'INR',
  EUR: 'EUR', EURO: 'EUR', CNY: 'CNY', RMB: 'CNY', MYR: 'MYR', GBP: 'GBP', 'HK$': 'HKD', HKD: 'HKD',
};
const CUR_ALT = Object.keys(CURRENCY_MAP).map((k) => k.replace('$', '\\$')).join('|');
// "(JPY)" anywhere, or a bare trailing "JPY" ("COMAC SPA (CS) JPY").
const CURRENCY_RE = new RegExp(`\\((${CUR_ALT})\\)|\\b(${CUR_ALT})\\s*$`, 'i');

function parseSupplier(raw: string): { name: string; currency: string; recognised: boolean } {
  const m = raw.match(CURRENCY_RE);
  const tok = m ? (m[1] || m[2]).toUpperCase() : null;
  const currency = tok ? CURRENCY_MAP[tok] : 'SGD';
  const name = raw.replace(CURRENCY_RE, ' ').replace(/\s+/g, ' ').trim();
  return { name, currency, recognised: !!m };
}

// Legacy typos collapse onto the AIMS default; everything else keeps its code.
const UOM_MAP: Record<string, string> = { PC: 'PCS', PCS: 'PCS', 'PC\\': 'PCS', '1': 'PCS', '': 'PCS' };
const mapUom = (u: string) => UOM_MAP[u.toUpperCase()] ?? u.toUpperCase();
// Legacy doc-type prefix on the reference: SIN = supplier invoice, SPR = supplier purchase return.
const kindOf = (reference: string): 'SIN' | 'SPR' => (/^SPR\b/i.test(reference) ? 'SPR' : 'SIN');

// The sheet's dates are calendar days (Singapore). SheetJS hands them back as
// JS Dates shifted to UTC (a 2023-08-04 cell reads 2023-08-03T16:00Z), so take
// the SGT calendar day and store it as UTC midnight of that day.
function excelDate(v: any): Date | null {
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400 * 1000));
  else if (typeof v === 'string' && v.trim()) d = new Date(v);
  if (!d || isNaN(d.getTime())) return null;
  const sgt = new Date(d.getTime() + 8 * 3600 * 1000);
  return new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()));
}

const HEADERS = ['Reference', 'Date', 'Supplier', 'Supplier Name', 'Stock Code', 'Description', 'Quantity', 'Uom', 'Category', 'Cost', 'Total Cost'];

function readSheet(file: string): Row[] {
  const wb = XLSX.readFile(file, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const s = (v: any) => (v == null ? '' : String(v).trim());
  const rows: Row[] = [];
  let col: Record<string, number> | null = null; // header name → column index (the sheet's range may not start at A)
  raw.forEach((r, idx) => {
    if (!col) {
      const cells = r.map(s);
      if (HEADERS.every((h) => cells.includes(h))) col = Object.fromEntries(HEADERS.map((h) => [h, cells.indexOf(h)]));
      return;
    }
    const c = (h: string) => r[col![h]];
    if (!s(c('Reference')) || !s(c('Stock Code'))) return;
    const date = excelDate(c('Date'));
    if (!date) return;
    rows.push({
      reference: s(c('Reference')).replace(/\s+/g, ' '), // "SIN   X" and "SIN X" are the same bill
      date,
      supplierCode: s(c('Supplier')),
      supplierName: s(c('Supplier Name')),
      stockCode: s(c('Stock Code')),
      description: s(c('Description')),
      quantity: Number(c('Quantity')) || 0,
      uom: s(c('Uom')),
      category: s(c('Category')),
      cost: Number(c('Cost')) || 0,
      total: Number(c('Total Cost')) || 0,
      idx,
    });
  });
  if (!col) throw new Error('header row not found (expected Reference … Total Cost)');
  return rows;
}

const later = (a: Row, b: Row) => (a.date.getTime() !== b.date.getTime() ? a.date.getTime() > b.date.getTime() : a.idx > b.idx);

function assertOrgOnly(rows: any[], label: string) {
  for (const r of rows) {
    if ('organizationId' in r && r.organizationId !== ORG_ID) throw new Error(`REFUSED: ${label} carries organizationId=${r.organizationId}`);
  }
}
async function createMany(model: any, label: string, rows: any[], chunk = 1000) {
  assertOrgOnly(rows, label);
  if (!APPLY || !rows.length) return;
  for (let i = 0; i < rows.length; i += chunk) {
    await model.createMany({ data: rows.slice(i, i + chunk), skipDuplicates: true });
    process.stdout.write(`\r    ${label}: ${Math.min(i + chunk, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`env=${ENV}  layout=${layout}  stage=${STAGE}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}\nfile=${FILE}`);
  const org = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { name: true } });
  if (!org || org.name !== ORG_NAME) throw new Error(`Org ${ORG_ID} (${ORG_NAME}) not found in ${ENV}`);

  const rows = readSheet(FILE);
  const years = [...new Set(rows.map((r) => r.date.getUTCFullYear()))].sort();
  console.log(`\nsheet: ${rows.length} lines, ${years[0]}–${years[years.length - 1]}, total cost ${R(rows.reduce((s, r) => s + r.total, 0)).toLocaleString()}`);

  // ── 1. Suppliers ──────────────────────────────────────────────────────────
  const supplierIds = new Map<string, string>(); // code → id
  {
    const byCode = new Map<string, { raw: string; name: string; currency: string; recognised: boolean; lines: number }>();
    for (const r of rows) {
      const cur = byCode.get(r.supplierCode);
      if (cur) { cur.lines++; continue; }
      const parsed = parseSupplier(r.supplierName);
      byCode.set(r.supplierCode, { raw: r.supplierName, ...parsed, lines: 1 });
    }
    const existing = await p.supplier.findMany({ where: { organizationId: ORG_ID }, select: { id: true, supplierCode: true, name: true } });
    for (const e of existing) if (e.supplierCode) supplierIds.set(e.supplierCode, e.id);
    const toCreate: any[] = [];
    const unrecognised: string[] = [];
    for (const [code, s] of byCode) {
      if (supplierIds.has(code)) continue;
      if (!s.recognised) unrecognised.push(`${code} "${s.raw}" → SGD`);
      const id = randomUUID();
      supplierIds.set(code, id);
      toCreate.push({ id, organizationId: ORG_ID, supplierCode: code, name: s.name, currency: s.currency });
    }
    const curCount = new Map<string, number>();
    for (const s of byCode.values()) curCount.set(s.currency, (curCount.get(s.currency) || 0) + 1);
    console.log(`\n── 1. Suppliers: ${byCode.size} in sheet, ${existing.length} exist, ${toCreate.length} to create`);
    console.log(`    currencies: ${[...curCount].map(([c, n]) => `${c}×${n}`).join(' ')}`);
    if (unrecognised.length) console.log(`    no currency suffix (default SGD):\n      ${unrecognised.join('\n      ')}`);
    console.log(`    e.g. ${toCreate.slice(0, 3).map((s) => `${s.supplierCode} ${s.name} (${s.currency})`).join(' | ')}`);
    if (STAGE === 'suppliers' || STAGE === 'all') await createMany(p.supplier, 'Supplier', toCreate);
  }

  // ── 2. Categories (brands) + 3. Assets (item master) ──────────────────────
  const assetIds = new Map<string, string>(); // stockCode → id
  {
    const latestByCode = new Map<string, Row>();
    for (const r of rows) {
      const cur = latestByCode.get(r.stockCode);
      if (!cur || later(r, cur)) latestByCode.set(r.stockCode, r);
    }
    const brandOf = (r: Row) => r.category || 'Uncategorised';
    const brands = new Set<string>([...latestByCode.values()].map(brandOf));
    const existingCats = await p.category.findMany({ where: { organizationId: ORG_ID }, select: { id: true, name: true } });
    const catIds = new Map<string, string>(existingCats.map((c: any) => [c.name, c.id]));
    const newCats: any[] = [];
    for (const b of brands) {
      if (catIds.has(b)) continue;
      const id = randomUUID();
      catIds.set(b, id);
      newCats.push({ id, organizationId: ORG_ID, name: b });
    }
    console.log(`\n── 2. Categories (brands): ${brands.size} in sheet, ${existingCats.length} exist, ${newCats.length} to create`);
    if (STAGE === 'items' || STAGE === 'all') await createMany(p.category, 'Category', newCats);

    const existingAssets = await p.asset.findMany({ where: { organizationId: ORG_ID, deletedAt: null }, select: { id: true, skuKey: true } });
    for (const a of existingAssets) assetIds.set(a.skuKey, a.id);
    const newAssets: any[] = [];
    const uomCount = new Map<string, number>();
    for (const [code, r] of latestByCode) {
      const uom = mapUom(r.uom);
      uomCount.set(uom, (uomCount.get(uom) || 0) + 1);
      if (assetIds.has(code)) continue;
      const id = randomUUID();
      assetIds.set(code, id);
      newAssets.push({
        id,
        organizationId: ORG_ID,
        skuKey: code,
        name: r.description || code,
        description: r.description || null,
        categoryId: catIds.get(brandOf(r)),
        uom,
        costPrice: r.cost || null, // last buy price
        price: null,
        isTracked: false, // counted parts, not serialised units
        isExternal: true,
        assetClass: 'EQUIPMENT',
        quantity: null, // on-hand stock ported separately
      });
    }
    const multiDesc = [...new Set(rows.map((r) => r.stockCode))].length;
    console.log(`\n── 3. Assets (item master): ${latestByCode.size} stock codes (${multiDesc} distinct), ${existingAssets.length} exist, ${newAssets.length} to create`);
    console.log(`    uom: ${[...uomCount].map(([u, n]) => `${u}×${n}`).join(' ')}`);
    console.log(`    costPrice = last buy price; quantity = NULL (stock port pending); isTracked=false`);
    console.log(`    e.g. ${newAssets.slice(0, 2).map((a) => `${a.skuKey} "${a.name}" ${a.uom} cost ${a.costPrice}`).join(' | ')}`);
    if (STAGE === 'items' || STAGE === 'all') await createMany(p.asset, 'Asset', newAssets);
  }

  // ── 4. Bills (+ 5. DocumentItems) ─────────────────────────────────────────
  if (STAGE === 'bills' || STAGE === 'all') {
    type Bucket = { key: string; reference: string; supplierCode: string; rows: Row[] };
    const buckets = new Map<string, Bucket>();
    for (const r of rows) {
      const key = `${r.supplierCode}|${r.reference}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { key, reference: r.reference, supplierCode: r.supplierCode, rows: [] }));
      b.rows.push(r);
    }
    // Bill number = legacy reference without its "SIN "/"SPR " doc-type prefix.
    // The same number used by two suppliers gets the supplier code appended so
    // Document(name, org, template) stays unique.
    // A return quotes the invoice it reverses, so SPRs keep their prefix.
    const billNo = (b: Bucket) => {
      const n = b.reference.replace(/^(SIN|SPR)\s+/i, '').trim() || b.reference;
      return kindOf(b.reference) === 'SPR' ? `SPR ${n}` : n;
    };
    const nameUse = new Map<string, number>();
    for (const b of buckets.values()) nameUse.set(billNo(b), (nameUse.get(billNo(b)) || 0) + 1);

    const existingDocs = await p.document.findMany({ where: { organizationId: ORG_ID, type: 'BILL' }, select: { id: true, name: true, config: true } });
    const existingKeys = new Set<string>(existingDocs.map((d: any) => d.config?.legacyKey).filter(Boolean));
    const existingNames = new Set<string>(existingDocs.map((d: any) => d.name));

    let tmpl = await plat.documentTemplate.findFirst({ where: { organizationId: ORG_ID, type: 'BILL' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!tmpl) {
      // Same thin template bills.service getOrCreateBillTemplate() creates.
      const id = randomUUID();
      console.log(`\n    BILL template: create (${id})`);
      if (APPLY) {
        tmpl = await plat.documentTemplate.create({
          data: {
            id,
            organizationId: ORG_ID,
            name: 'Bill',
            type: 'BILL',
            isActive: true,
            templateVariant: 'Default',
            designName: 'Default',
            config: {
              tableColumnOrder: ['description', 'quantity', 'unitPrice', 'taxAmount', 'amount'],
              columnLabels: { description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', taxAmount: 'Tax', amount: 'Amount' },
              formFields: [],
            },
          },
          select: { id: true },
        });
      } else tmpl = { id };
    }

    const docs: any[] = [];
    const items: any[] = [];
    let skipped = 0, returns = 0, returnsValue = 0, oddSign = 0, multiDate = 0, missingAsset = 0;
    const dupNames: string[] = [];
    let gross = 0;
    const list = [...buckets.values()];
    for (const b of LIMIT ? list.slice(0, LIMIT) : list) {
      if (existingKeys.has(b.key)) { skipped++; continue; }
      const supplierId = supplierIds.get(b.supplierCode);
      if (!supplierId) throw new Error(`supplier ${b.supplierCode} unresolved (run --stage suppliers first)`);
      const supplierName = parseSupplier(b.rows[0].supplierName).name;
      let name = billNo(b);
      if ((nameUse.get(name) || 0) > 1) name = `${name} [${b.supplierCode}]`;
      if (existingNames.has(name)) { skipped++; dupNames.push(`${b.key} → ${name}`); continue; }
      existingNames.add(name);

      const sorted = [...b.rows].sort((a, c) => a.date.getTime() - c.date.getTime() || a.idx - c.idx);
      const billDate = sorted[0].date;
      if (new Set(sorted.map((r) => r.date.toISOString().slice(0, 10))).size > 1) multiDate++;
      // SPR lines come through as qty −n × cost −c = +total; AIMS stores a
      // return with POSITIVE amounts and kind SPR (the UI applies the sign).
      const isReturn = kindOf(b.reference) === 'SPR';
      if (isReturn) returns++;
      if (sorted.some((r) => (isReturn ? r.quantity > 0 : r.quantity < 0 || r.total < 0))) oddSign++;
      const docId = randomUUID();
      const lines = sorted.map((r, i) => {
        const assetId = assetIds.get(r.stockCode);
        if (!assetId) missingAsset++;
        return {
          lineNumber: i + 1,
          description: `${r.stockCode} ${r.description}`.trim(),
          stockCode: r.stockCode,
          assetId: assetId || null,
          quantity: Math.abs(r.quantity),
          unitPrice: Math.abs(r.cost),
          amount: R(Math.abs(r.total)),
          uom: mapUom(r.uom),
          category: r.category || null,
          date: r.date.toISOString(),
        };
      });
      const subtotal = R(lines.reduce((s, l) => s + l.amount, 0));
      if (isReturn) returnsValue += subtotal;
      let config: any = {
        legacyKey: b.key,
        legacyImported: true,
        importSource: SOURCE_LABEL,
        supplierId,
        supplier: { id: supplierId, name: supplierName },
        billDate: billDate.toISOString(),
        date: billDate.toISOString(),
        dueDate: null,
        reference: b.reference,
        referenceNo: b.reference,
        description: null,
        currency: 'SGD',
        subtotal,
        taxAmount: 0,
        totalAmount: subtotal,
        amountPaid: subtotal,
        amountsAre: 'NO_TAX',
        documentInfo: { taxCode: null, gstPercent: 0, absorbTax: false, currency: 'SGD' },
        lines,
        items: lines,
        billStatus: 'PAID',
        kind: isReturn ? 'SPR' : 'SIN',
        sourcePoId: null,
        inboundChannel: 'IMPORT',
        inboundMeta: { source: SOURCE_LABEL, supplierCode: b.supplierCode, lines: lines.length },
        journalEntryId: null, // historical — the GL is ported separately
        postedAt: billDate.toISOString(),
      };
      config = stampDocumentMoney(config, { gross: subtotal, paid: subtotal, outstanding: 0 });
      gross += isReturn ? -subtotal : subtotal;
      docs.push({ id: docId, organizationId: ORG_ID, documentTemplateId: tmpl.id, type: 'BILL', name, status: 'paid', config });
      for (const l of lines) {
        if (!l.assetId) continue;
        items.push({
          documentId: docId,
          itemId: l.assetId,
          itemType: 'ASSET',
          assetId: l.assetId,
          sku: l.stockCode,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: l.amount,
          uom: l.uom,
          lineNumber: l.lineNumber,
        });
      }
    }
    const maxLines = Math.max(0, ...docs.map((d) => d.config.lines.length));
    console.log(`\n── 4. Bills: ${buckets.size} (reference × supplier) in sheet, ${existingDocs.length} exist, ${skipped} skipped, ${docs.length} to create${LIMIT ? ` (limit ${LIMIT})` : ''}`);
    console.log(`    net purchases ${R(gross).toLocaleString()} SGD · ${returns} purchase returns (SPR) worth ${R(returnsValue).toLocaleString()} · ${oddSign} bills with an unexpected sign · ${multiDate} bills spanning >1 date · max ${maxLines} lines/bill`);
    if (dupNames.length) console.log(`    duplicate names skipped:\n      ${dupNames.join('\n      ')}`);
    const adj = docs.filter((d) => d.config.inboundMeta.supplierCode === 'ADJ');
    if (adj.length) console.log(`    ⚠ ${adj.length} bills under pseudo-supplier ADJ "STOCK ADJUSTMENT" (${R(adj.reduce((s, d) => s + d.config.totalAmount, 0))} SGD) — legacy stock adjustments, kept as bills`);
    console.log(`    status PAID, NO_TAX, currency SGD, no journal (GL ported separately), inboundChannel IMPORT`);
    console.log(`    e.g. ${docs.slice(0, 2).map((d) => `${d.name} ${d.config.supplier.name} ${d.config.billDate.slice(0, 10)} ${d.config.lines.length} lines ${d.config.totalAmount}`).join(' | ')}`);
    console.log(`\n── 5. DocumentItems: ${items.length} lines → Asset links${missingAsset ? ` (${missingAsset} lines with no asset — run --stage items first)` : ''}`);
    if (APPLY && missingAsset) throw new Error('refusing to write bills while lines have no asset');
    // Documents carry up to ~1000-line JSON configs — smaller chunks.
    await createMany(p.document, 'Document', docs, 100);
    await createMany(p.documentItem, 'DocumentItem', items, 2000);
  }
}

main()
  .then(() => console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'} — ${ORG_NAME} ${ORG_ID}${APPLY ? '' : '\nRe-run with --apply to write.'}`))
  .catch((e) => { console.error('❌', e?.message || e); process.exit(1); })
  .finally(() => disconnect());
