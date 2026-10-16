/**
 * Put back the per-line AIMS fields that mirror-xero-to-aims.ts overwrote
 * (guru, 2026-10-15).
 *
 * The mirror rebuilt config.items from Xero's LineItems, which carry only
 * description/qty/unit price/amount/account code/tax. Every AIMS-only per-line
 * field was dropped on 3,776 documents between 2026-10-14T23:52:56Z and
 * 23:54:03Z. Config-LEVEL keys survived (the mirror spread `...c`), so only the
 * items array needs repairing.
 *
 * Reads a Neon point-in-time branch taken just BEFORE the mirror ran and merges
 * the missing fields onto the CURRENT lines, matched by lineNumber. Xero's
 * corrected figures — amount, accountCode, tax, description — are left exactly
 * as they are now; only fields ABSENT from the current line are restored, so
 * this cannot undo the good part of the sync.
 *
 *   PAST_DATABASE_URL=<branch uri> npx ts-node --transpile-only \
 *     scripts/merge-restored-line-fields.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const PAST_URL = process.env.PAST_DATABASE_URL;
if (!PAST_URL) { console.error('Set PAST_DATABASE_URL to the recovery branch connection string.'); process.exit(1); }

// Per-line keys that belong to AIMS and that Xero never carries.
const AIMS_LINE_KEYS = [
  'itemCode', 'inventoryItemId', 'assetId', 'uom', 'isService', 'isFixedAsset',
  'id', 'skuKey', 'sku', 'revenueTag', 'rateMerge', 'isGroupHeader',
  'serialNumbers', 'deliveryItemId', 'deliveryGroup', 'salePrice',
];

const mk = (url: string) => new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) } as any);

(async () => {
  console.log(`Merge restored line fields   ${APPLY ? '*** APPLY ***' : 'DRY RUN'}\n`);
  const past = mk(PAST_URL);
  const now = mk(fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1]);

  const current = await now.document.findMany({
    where: { organizationId: ORG },
    select: { id: true, name: true, config: true },
  });
  const touched = current.filter((d: any) => (d.config || {}).paymentStatusSource === 'mirror-xero-2026-10-15');
  console.log(`documents the mirror rewrote: ${touched.length}`);

  const ids = touched.map((d: any) => d.id);
  const oldRows: any[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    oldRows.push(...await past.document.findMany({ where: { id: { in: ids.slice(i, i + 500) } }, select: { id: true, config: true } }));
  }
  const oldById = new Map(oldRows.map((r: any) => [r.id, r.config]));
  console.log(`found in the restore branch:  ${oldById.size}\n`);

  let restored = 0, nothing = 0, absent = 0, fieldCount = 0;
  const perField: Record<string, number> = {};

  for (const d of touched) {
    const before: any = oldById.get(d.id);
    if (!before) { absent++; continue; }
    const oldItems: any[] = before.items || [];
    const cur: any = d.config || {};
    const newItems: any[] = cur.items || [];
    if (!oldItems.length || !newItems.length) { nothing++; continue; }

    const byLine = new Map<number, any>();
    oldItems.forEach((it: any, i: number) => byLine.set(Number(it.lineNumber ?? i + 1), it));

    let hit = false;
    const merged = newItems.map((it: any, i: number) => {
      const o = byLine.get(Number(it.lineNumber ?? i + 1));
      if (!o) return it;
      const add: any = {};
      for (const k of AIMS_LINE_KEYS) {
        if (o[k] !== undefined && it[k] === undefined) {
          add[k] = o[k]; hit = true; fieldCount++;
          perField[k] = (perField[k] || 0) + 1;
        }
      }
      return Object.keys(add).length ? { ...it, ...add } : it;
    });

    if (!hit) { nothing++; continue; }
    restored++;
    if (restored <= 10) console.log(`  ${String(d.name).slice(0, 30).padEnd(32)} ${newItems.length} lines`);
    if (!APPLY) continue;
    await now.document.update({ where: { id: d.id }, data: { config: { ...cur, items: merged } as any } });
  }

  console.log(`\n  ${APPLY ? 'restored' : 'would restore'} ${restored} documents   nothing missing ${nothing}   not in branch ${absent}`);
  console.log(`  ${fieldCount} line fields:`);
  Object.entries(perField).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`     ${k.padEnd(18)} ${n}`));
  if (!APPLY) console.log('\n  DRY RUN — re-run with --apply.');
  await past.$disconnect(); await now.$disconnect();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
