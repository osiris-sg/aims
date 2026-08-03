// Guru 2026-07-28 (prod Biofuel):
//  1. SMM JP bills → external customer account (line 442 → 443).
//  2. All Chuan Lim JP bills → reference BIPL-JPSG-INV-20260630-0001 (the paid
//     consolidated invoice) + matching "Ref Invoice:" description.
// AIMS DB only — Xero side untouched (staged per the AIMS-before-Xero rule).
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const ACC_442 = '23a307d7-2bed-4158-99b8-ffd407bf7fff';
const ACC_443 = 'b16e866d-5a25-4876-bf67-8e20f7dc6fa5';
const NEW_REF = 'BIPL-JPSG-INV-20260630-0001';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main() {
  // 1. SMM bills: reference "(SMM ...)" pattern, line account 442.
  const smm: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, config FROM "Document"
      WHERE "organizationId" = $1 AND type = 'BILL' AND name LIKE 'JP%'
        AND config->>'reference' ILIKE '%SMM%'`, ORG);
  console.log(`SMM bills: ${smm.length}`);
  for (const r of smm) {
    const c = r.config;
    const lines = (c.lines || []).map((l: any) => (l.accountId === ACC_442 ? { ...l, accountId: ACC_443 } : l));
    const items = Array.isArray(c.items) ? c.items.map((l: any) => (l.accountId === ACC_442 ? { ...l, accountId: ACC_443 } : l)) : c.items;
    const changed = JSON.stringify(lines) !== JSON.stringify(c.lines);
    console.log(`  ${r.name}: ${changed ? '442 → 443' : 'already 443'}`);
    if (APPLY && changed) {
      await prisma.document.update({ where: { id: r.id }, data: { config: { ...c, lines, ...(items !== undefined ? { items } : {}) } } });
    }
  }
  // 2. Chuan Lim bills: any JP bill whose config mentions chuan lim.
  const cl: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, config FROM "Document"
      WHERE "organizationId" = $1 AND type = 'BILL' AND name LIKE 'JP%'
        AND config::text ILIKE '%chuan%lim%'`, ORG);
  console.log(`\nChuan Lim bills: ${cl.length}`);
  const refCounts = new Map<string, number>();
  for (const r of cl) refCounts.set(r.config?.reference || '(none)', (refCounts.get(r.config?.reference || '(none)') || 0) + 1);
  for (const [ref, n] of refCounts) console.log(`  current ref "${ref}": ${n} bills`);
  let updated = 0;
  for (const r of cl) {
    const c = r.config;
    if (c.reference === NEW_REF) continue;
    if (APPLY) {
      await prisma.document.update({
        where: { id: r.id },
        data: { config: { ...c, reference: NEW_REF, description: `Ref Invoice: ${NEW_REF}` } },
      });
    }
    updated++;
  }
  console.log(`${APPLY ? 'Updated' : 'Would update'} ${updated} Chuan Lim bill refs → ${NEW_REF}`);
  if (!APPLY) console.log('dry-run — pass --apply');
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
