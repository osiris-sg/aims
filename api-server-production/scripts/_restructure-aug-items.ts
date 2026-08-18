// Rebuild the generated August invoices' items from their JULY counterparts
// (guru 2026-08-18: "run the change to fix the aims invoices"). July is the
// formatting blueprint: $0 period-header, numbered equipment lines with
// amounts + account codes, $0 narrative lines, DISCOUNT lines with account
// codes, $0 refs/location/attn lines.
// Transform per line: full-calendar-month date ranges shift +1 month (handles
// arrears too), "Nth mth" increments, "This Tax Invoice supersede…" intro is
// dropped, product codes stamped on positive equipment lines, $0 lines carry
// no account/product/tag. HARD GUARD: per-doc subTotal must not move.
// The recurring templates get the same structure with {tokens}.
// Prod only. Dry-run by default; --apply to write.
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production'), override: true });
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const R2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (n: number) => String(n).padStart(2, '0');
const ordinal = (n: number) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; };
const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// full-calendar-month "dd/mm/yyyy to dd/mm/yyyy" → next month (or tokens)
function shiftRanges(text: string, mode: 'date' | 'token'): string {
  return text.replace(/01\/(\d{2})\/(\d{4})\s*(to|-|–)\s*(\d{2})\/(\d{2})\/(\d{4})/g, (m, m1, y1, sep, d2, m2, y2) => {
    const last = new Date(Number(y2), Number(m2), 0).getDate();
    if (m1 !== m2 || y1 !== y2 || Number(d2) !== last) return m; // not a full month — leave
    if (mode === 'token') {
      // June range inside a July invoice = arrears → PREV MONTH tokens
      return Number(m1) === 6 ? `{PREV MONTH START} ${sep} {PREV MONTH END}` : `{MONTH START} ${sep} {MONTH END}`;
    }
    const ny = Number(m1) === 12 ? Number(y1) + 1 : Number(y1);
    const nm = (Number(m1) % 12) + 1;
    const nLast = new Date(ny, nm, 0).getDate();
    return `01/${pad2(nm)}/${ny} ${sep} ${pad2(nLast)}/${pad2(nm)}/${ny}`;
  });
}
const bumpNth = (text: string, mode: 'date' | 'token') =>
  text.replace(/(\d{1,3})(?:st|nd|rd|th)(\s+mth)/gi, (_m, n, tail) => (mode === 'token' ? `{NTH}${tail}` : `${ordinal(parseInt(n, 10) + 1)}${tail}`));
const dropSupersede = (text: string) => text.replace(/^This Tax Invoice supersede[^\n]*\n?/i, '').trimStart();

type Asset = { id: string; skuKey: string; name: string };
function resolveAsset(d: string, assets: Asset[]): Asset | null {
  const bySku = (nm: string) =>
    assets.find((a) => norm(a.skuKey) === nm) ||
    assets.find((a) => nm.length >= 4 && (norm(a.skuKey).includes(nm) || nm.includes(norm(a.skuKey)))) ||
    assets.find((a) => norm(a.name) === nm) || null;
  const model = /Model\s*:\s*([A-Za-z0-9 /.-]+)/.exec(d)?.[1];
  if (model) { const hit = bySku(norm(model.replace(/capacity.*$/i, ''))); if (hit) return hit; }
  if (/SIDS\s+System/i.test(d)) return assets.find((a) => norm(a.skuKey) === 'SIDS') || null;
  if (/waste\s*water\s*holding\s*tank/i.test(d)) return assets.find((a) => /waste water holding tank/i.test(a.name)) || null;
  if (/db\s*box/i.test(d)) return assets.find((a) => norm(a.skuKey) === 'DBBOX') || null;
  if (/FIREFLY/i.test(d)) return assets.find((a) => /firefly/i.test(a.name)) || null;
  const nd = norm(d);
  let best: Asset | null = null; let bestLen = 4;
  for (const a of assets) {
    if (['RENTAL', 'TP', 'DB', 'SOIL', 'VEHICLE', 'SIMCARD'].includes(a.skuKey.toUpperCase())) continue;
    for (const key of [norm(a.skuKey), norm(a.name)]) if (key.length > bestLen && nd.includes(key)) { best = a; bestLen = key.length; }
  }
  return best;
}

async function main() {
  const assets: Asset[] = (await p.$queryRawUnsafe(
    `SELECT id, "skuKey", name FROM "Asset" WHERE "organizationId"='${ORG}' AND "deletedAt" IS NULL AND "skuKey" IS NOT NULL`,
  ) as any[]).map((r: any) => ({ id: r.id, skuKey: r.skuKey, name: r.name || '' }));

  const tpls = await p.recurringInvoiceTemplate.findMany({
    where: { organizationId: ORG, lastRunDocumentId: { not: null } },
    select: { id: true, name: true, config: true, sourceDocumentId: true, lastRunDocumentId: true },
  });
  let fixed = 0, skipped = 0;
  for (const t of tpls.sort((a, b) => a.name.localeCompare(b.name))) {
    const src = await p.document.findUnique({ where: { id: t.sourceDocumentId! }, select: { name: true, config: true } });
    const gen = await p.document.findUnique({ where: { id: t.lastRunDocumentId! }, select: { id: true, name: true, config: true } });
    if (!src || !gen) continue;
    const gc: any = gen.config;
    const julyItems: any[] = ((src.config as any)?.items || []);
    if (!julyItems.length) { console.log(`SKIP ${gen.name} — July ${src.name} has no items`); skipped++; continue; }

    const build = (mode: 'date' | 'token') => {
      let idSeed = Date.now();
      return julyItems.map((ji: any, idx: number) => {
        const amount = R2(Number(ji.amount) || 0);
        let desc = dropSupersede(String(ji.description || ''));
        desc = bumpNth(shiftRanges(desc, mode), mode);
        const it: any = {
          id: ++idSeed,
          itemCode: '',
          inventoryItemId: '',
          description: desc,
          quantity: Number(ji.quantity) || 1,
          unitPrice: R2(Number(ji.unitPrice) || 0),
          amount,
          lineNumber: idx + 1,
        };
        if (amount !== 0) {
          it.accountCode = ji.accountCode ? String(ji.accountCode) : null;
          it.tax = 9;
          it.taxAmount = R2(amount * 0.09);
          if (amount > 0) {
            const a = resolveAsset(desc, assets);
            if (a) { it.itemCode = a.skuKey; it.inventoryItemId = a.id; it.revenueTag = 'rental'; it.isService = false; }
          }
        } else {
          it.tax = 0; it.taxAmount = 0;
        }
        return it;
      });
    };

    const newItems = build('date');
    const newNet = R2(newItems.reduce((s, i) => s + i.amount, 0));
    const oldNet = R2(Number(gc.subTotal) || 0);
    if (newNet !== oldNet) { console.log(`SKIP ${gen.name} — total would move: ${oldNet} → ${newNet} (July ${src.name})`); skipped++; continue; }
    const newGst = R2(newItems.reduce((s, i) => s + (i.taxAmount || 0), 0));
    const gstNote = Math.abs(newGst - R2(Number(gc.gstAmount) || 0)) > 0.011 ? ` ⚠gst ${gc.gstAmount}→${newGst}` : '';
    console.log(`FIX  ${gen.name} ← July ${src.name}: 1 block → ${newItems.length} lines | net ${newNet}${gstNote}`);
    fixed++;
    if (!APPLY) continue;
    await p.document.update({
      where: { id: gen.id },
      data: { config: { ...gc, items: newItems, subTotal: newNet, gstAmount: newGst, nettTotal: R2(newNet + newGst) } as any },
    });
    // template: same structure with tokens (September then generates split)
    const tc: any = t.config || {};
    const tplItems = build('token').map((it: any) => { const { taxAmount, tax, ...rest } = it; return rest; });
    await p.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...tc, items: tplItems } } });
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: fixed=${fixed} skipped=${skipped} (Obayashi BI202608065 untouched by design)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
