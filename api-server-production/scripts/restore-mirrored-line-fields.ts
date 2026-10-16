/**
 * Recover the per-line AIMS fields my mirror overwrote (guru, 2026-10-15).
 *
 * scripts/mirror-xero-to-aims.ts rebuilt config.items from Xero's LineItems.
 * Xero lines carry only description/qty/unit price/amount/account code/tax, so
 * every AIMS-only per-line field was dropped on 3,776 documents between
 * 2026-10-14T23:52:56Z and 23:54:03Z: itemCode, inventoryItemId, uom,
 * isService, the line id, and anything else the editor had put there.
 *
 * Config-LEVEL keys survived (the mirror spread `...c`), so only the items
 * array needs repairing.
 *
 * Method: open a Neon point-in-time branch from just BEFORE the mirror ran,
 * read the original config.items, and merge the missing fields back onto the
 * CURRENT lines matched by lineNumber. Xero's figures — amount, accountCode,
 * tax, description — are left exactly as they are now; only fields absent from
 * the current line are restored.
 *
 *   NEON_API_KEY=xxx NEON_PROJECT_ID=yyy \
 *     npx ts-node --transpile-only scripts/restore-mirrored-line-fields.ts [--apply] [--keep-branch]
 *
 * Dry-run by default. The branch is deleted afterwards unless --keep-branch.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const APPLY = process.argv.includes('--apply');
const KEEP = process.argv.includes('--keep-branch');
const API_KEY = process.env.NEON_API_KEY;
const PROJECT = process.env.NEON_PROJECT_ID;
const API = 'https://console.neon.tech/api/v2';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const BRANCH_NAME = 'recover-mirror-20261015';
// The mirror's first write was 23:52:56.739Z — step back to before it started.
const RESTORE_TO = process.env.RESTORE_TO || '2026-10-14T23:52:00.000Z';

// Per-line keys that belong to AIMS and that Xero never carries.
const AIMS_LINE_KEYS = [
  'itemCode', 'inventoryItemId', 'assetId', 'uom', 'isService', 'isFixedAsset',
  'id', 'skuKey', 'sku', 'revenueTag', 'rateMerge', 'isGroupHeader',
  'serialNumbers', 'deliveryItemId', 'deliveryGroup', 'salePrice', 'tax',
];

if (!API_KEY || !PROJECT) {
  console.error('Missing NEON_API_KEY and/or NEON_PROJECT_ID.');
  console.error('  key:     https://console.neon.tech/app/settings/api-keys');
  console.error('  project: Neon dashboard URL or project settings');
  process.exit(1);
}

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  console.log(`Recover mirrored line fields   ${APPLY ? '*** APPLY ***' : 'DRY RUN'}`);
  console.log(`  restore point: ${RESTORE_TO}\n`);

  const { branches } = await api('GET', `/projects/${PROJECT}/branches`);
  const main = branches.find((b: any) => b.primary || b.name === 'main');
  if (!main) throw new Error('could not find the main branch');
  const old = branches.find((b: any) => b.name === BRANCH_NAME);
  if (old) {
    console.log(`  removing a leftover ${BRANCH_NAME} branch`);
    await api('DELETE', `/projects/${PROJECT}/branches/${old.id}`);
  }

  console.log('  creating point-in-time branch…');
  const made = await api('POST', `/projects/${PROJECT}/branches`, {
    branch: { name: BRANCH_NAME, parent_id: main.id, parent_timestamp: RESTORE_TO },
    endpoints: [{ type: 'read_write' }],
  });
  const branchId = made.branch.id;
  console.log(`  branch ${branchId} created`);

  let restored = 0, unchanged = 0, missing = 0, lineFixes = 0;
  try {
    const { uri } = await api(
      'GET',
      `/projects/${PROJECT}/connection_uri?branch_id=${branchId}&role_name=AIMS_DB_owner&database_name=AIMS_DB&pooled=true`,
    );
    const past = new PrismaClient({ adapter: new PrismaNeon({ connectionString: uri }) } as any);
    const now = new PrismaClient({
      adapter: new PrismaNeon({ connectionString: fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }),
    } as any);

    const current = await now.document.findMany({
      where: { organizationId: ORG },
      select: { id: true, name: true, config: true },
    });
    const touched = current.filter((d: any) => (d.config || {}).paymentStatusSource === 'mirror-xero-2026-10-15');
    console.log(`  documents the mirror rewrote: ${touched.length}\n`);

    for (const d of touched) {
      const before: any = await past.document.findUnique({ where: { id: d.id }, select: { config: true } });
      if (!before) { missing++; continue; }
      const oldItems: any[] = (before.config || {}).items || [];
      const cur: any = d.config || {};
      const newItems: any[] = cur.items || [];
      if (!oldItems.length || !newItems.length) { unchanged++; continue; }

      const byLine = new Map<number, any>();
      oldItems.forEach((it: any, i: number) => byLine.set(Number(it.lineNumber ?? i + 1), it));

      let changedHere = false;
      const merged = newItems.map((it: any, i: number) => {
        const o = byLine.get(Number(it.lineNumber ?? i + 1));
        if (!o) return it;
        const add: any = {};
        for (const k of AIMS_LINE_KEYS) {
          // Restore ONLY what is absent now — never overwrite Xero's figures.
          if (o[k] !== undefined && it[k] === undefined) { add[k] = o[k]; changedHere = true; lineFixes++; }
        }
        return Object.keys(add).length ? { ...it, ...add } : it;
      });

      if (!changedHere) { unchanged++; continue; }
      restored++;
      if (restored <= 12) {
        const sample = merged.find((m: any, i: number) => m !== newItems[i]);
        console.log(`  ${String(d.name).slice(0, 28).padEnd(30)} restored ${Object.keys(sample || {}).filter((k) => AIMS_LINE_KEYS.includes(k)).join(', ') || '—'}`);
      }
      if (!APPLY) continue;
      await now.document.update({ where: { id: d.id }, data: { config: { ...cur, items: merged } as any } });
    }

    await past.$disconnect();
    await now.$disconnect();
  } finally {
    if (!KEEP) {
      console.log('\n  deleting the recovery branch…');
      await api('DELETE', `/projects/${PROJECT}/branches/${branchId}`).catch((e) => console.log(`  (branch delete failed: ${e.message})`));
    } else console.log(`\n  branch kept: ${branchId}`);
  }

  console.log(`\n  ${APPLY ? 'restored' : 'would restore'} ${restored} documents (${lineFixes} line fields)   nothing to do ${unchanged}   not present at that time ${missing}`);
  if (!APPLY) console.log('  DRY RUN — re-run with --apply.');
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
