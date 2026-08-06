/**
 * Populate the free-text "Reference" column (config.referenceNo) on every
 * Osiris invoice, so the invoice list says what each one is FOR.
 *
 * Dry:    npx ts-node --transpile-only scripts/_osiris-invoice-references.ts .env.production
 * Apply:  ... .env.production --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env.production';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';

// Derived from each invoice's own line items. NOTE: referenceNo also renders on
// the printed invoice, so these are worded to be safe in front of a customer.
const REFS: Record<string, string> = {
  'TI2202605-001': 'Test data — safe to delete',
  'TI2202605-002': 'Test data — safe to delete',
  'TI2202605-003': 'Google Cloud recharge — Oct 2025',
  'TI2202605-004': 'Test data — safe to delete',
  'TI2202605-005': 'Nettbox — 12 units @ 100 (incomplete)',
  'TI2202607-001': 'Autopack — Jetson Orin NX AI dev kits x2',
  'TI2202607-002': 'Autopack — Jetson kits (draft copy of TI2202607-001)',
  'TI2202607-003': 'Hardware supply — 45 Shipyard Rd & JPSG',
  'TI2202607-004': 'Jurong Port Staging Ground — software',
  'TI2202607-005': 'Empty — no line items',
  'TI2202607-006': 'Revision of TI2202607-003 + JPSG domain — do not bill both',
  'TI2202608-001': 'ESS + SIDS maintenance — June 2026',
  'TI2202608-002': 'ESS + SIDS maintenance — July 2026',
};

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====\n`);
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    orderBy: { name: 'asc' },
  });

  let done = 0;
  const unknown: string[] = [];
  for (const d of docs) {
    const ref = REFS[d.name!];
    if (!ref) {
      unknown.push(d.name!);
      continue;
    }
    const cfg: any = d.config || {};
    const existing = cfg.referenceNo || '';
    console.log(`${d.name}  [${d.status}]`);
    console.log(`   was: "${existing}"`);
    console.log(`   now: "${ref}"`);
    if (!APPLY) continue;
    await prisma.document.update({
      where: { id: d.id },
      data: { config: { ...cfg, referenceNo: ref } as any },
    });
    done += 1;
  }
  if (unknown.length) console.log(`\nNo reference defined for: ${unknown.join(', ')}`);
  console.log(APPLY ? `\nupdated ${done} invoices` : `\n(dry run — nothing written; re-run with --apply)`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
