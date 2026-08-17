// Map the generated August invoices' + recurring templates' priced lines to
// AIMS product codes (guru 2026-08-11: "in aims we have product codes —
// shouldn't it be mapped to product code"). Mirrors what the editor's product
// picker writes: itemCode = Asset.skuKey, inventoryItemId = Asset.id,
// revenueTag = 'rental', isService = false. Amounts and accountCode (already
// stamped from the July invoices) are NOT touched.
// Resolution: "Model: X" in the description, else longest asset skuKey/name
// found in the text. Unmatched lines are flagged, never guessed.
// Prod: templates + docs (BI2026080117–0187). Dev: templates only.
// Dry-run by default; --apply to write.
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const norm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

type Asset = { id: string; skuKey: string; name: string };

// Generic/service assets that must never win a fuzzy text match.
const JUNK = new Set(['RENTAL', 'TP', 'DB', 'SOIL', 'VEHICLE', 'SIMCARD', 'TRAILER', 'TRACKSET', 'WEIGHTBRIDGE']);

function resolveAsset(desc: string, assets: Asset[], docText?: string): Asset | null {
  const d = desc || '';
  const nd = norm(d);
  const bySku = (nm: string) =>
    assets.find((a) => norm(a.skuKey) === nm) ||
    assets.find((a) => nm.length >= 4 && !JUNK.has(a.skuKey.toUpperCase()) && (norm(a.skuKey).includes(nm) || nm.includes(norm(a.skuKey)))) ||
    assets.find((a) => norm(a.name) === nm) ||
    null;
  // 1. explicit "Model: LION375" / "Model: AF-40" / "Model: MBR-50 Capacity"
  const model = /Model\s*:\s*([A-Za-z0-9 /.-]+)/.exec(d)?.[1];
  if (model) {
    const hit = bySku(norm(model.replace(/capacity.*$/i, '')));
    if (hit) return hit;
  }
  // 2. "… unit (of) MBR-10 System" / "LION375 System" / "AF-40 System"
  const sys = /([A-Za-z]{2,10}[- ]?\d{1,4}(?:\/\d{2,4})?)\s+System/i.exec(d)?.[1];
  if (sys) {
    const hit = bySku(norm(sys));
    if (hit) return hit;
  }
  // 3. distinctive phrases
  if (/SIDS\s+System/i.test(d)) {
    const t = assets.find((a) => norm(a.skuKey) === 'SIDS');
    if (t) return t;
  }
  if (/waste\s*water\s*holding\s*tank/i.test(d) || (docText && /waste\s*water\s*holding\s*tank/i.test(docText) && /tank/i.test(d))) {
    const t = assets.find((a) => /waste water holding tank/i.test(a.name));
    if (t) return t;
  }
  if (/db\s*box/i.test(d)) {
    const t = assets.find((a) => norm(a.skuKey) === 'DBBOX');
    if (t) return t;
  }
  // 4. longest skuKey/name appearing in the text (min 5 chars, junk excluded)
  let best: Asset | null = null; let bestLen = 4;
  for (const a of assets) {
    if (JUNK.has(a.skuKey.toUpperCase())) continue;
    for (const key of [norm(a.skuKey), norm(a.name)]) {
      if (key.length > bestLen && nd.includes(key)) { best = a; bestLen = key.length; }
    }
  }
  return best;
}

async function run(envFile: string, doDocs: boolean) {
  const url = fs.readFileSync(path.resolve(__dirname, '..', envFile), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
  const p = new PrismaClient({ datasources: { db: { url } } });
  console.log(`\n########## ${envFile} ##########`);
  try {
    const assets: Asset[] = await p.$queryRawUnsafe(
      `SELECT id, "skuKey", name FROM "Asset" WHERE "organizationId"='${ORG}' AND "deletedAt" IS NULL AND "skuKey" IS NOT NULL`,
    ).then((rows: any) => rows.map((r: any) => ({ id: r.id, skuKey: r.skuKey, name: r.name || '' })));
    console.log(`assets in catalog: ${assets.length}`);

    const mapItems = (items: any[], tag: string): { items: any[]; changed: boolean; log: string[] } => {
      const log: string[] = [];
      let changed = false;
      const docText = (items || []).map((i: any) => i.description || '').join('\n');
      const out = (items || []).map((i: any) => {
        if (!(Number(i.unitPrice) > 0)) return i;
        if (i.itemCode) { log.push(`   = already ${i.itemCode}`); return i; }
        const a = resolveAsset(i.description || '', assets, docText);
        if (!a) { log.push(`   ⚠ UNMATCHED (${tag}): "${(i.description || '').split('\n').find((l: string) => l.trim()) || ''}"`.slice(0, 110)); return i; }
        log.push(`   → ${a.skuKey} (${a.name.slice(0, 35)})`);
        changed = true;
        return { ...i, itemCode: a.skuKey, inventoryItemId: a.id, isService: false, revenueTag: 'rental' };
      });
      return { items: out, changed, log };
    };

    const tpls = await p.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, config: true, lastRunDocumentId: true } });
    for (const t of tpls) {
      const c: any = t.config || {};
      const r = mapItems(c.items, t.name.slice(0, 30));
      console.log(`TPL ${t.name.slice(0, 55)}`);
      r.log.forEach((l) => console.log(l));
      if (APPLY && r.changed) await p.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, items: r.items } } });
    }

    if (doDocs) {
      const docs = await p.document.findMany({
        where: { organizationId: ORG, type: 'INVOICE', name: { gte: 'BI2026080117', lte: 'BI2026080187' } },
        orderBy: { name: 'asc' }, select: { id: true, name: true, config: true },
      });
      for (const d of docs) {
        const c: any = d.config;
        const r = mapItems(c.items, d.name!);
        console.log(`DOC ${d.name}`);
        r.log.forEach((l) => console.log(l));
        if (APPLY && r.changed) await p.document.update({ where: { id: d.id }, data: { config: { ...c, items: r.items } as any } });
      }
    }
  } finally {
    await p.$disconnect();
  }
}

(async () => {
  await run('.env.production', true);
  await run('.env', false);
  console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN — pass --apply');
})().catch((e) => { console.error(e); process.exit(1); });
