/**
 * Osiris prod invoice tidy-up (guru 2026-08-04):
 *   - delete the draft invoices (backed up to JSON first)
 *   - confirm the unconfirmed ones
 *
 * TI2202607-006 is deliberately EXCLUDED from the confirm set: it repeats 16 of
 * the 18 lines on TI2202607-003, which is already confirmed at 6,863.40.
 * Confirming it would bill Biofuel twice. Pass --include-006 to override.
 *
 * Dry:    npx ts-node --transpile-only scripts/_osiris-confirm-and-clean.ts .env.production
 * Apply:  ... .env.production --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env.production';
const APPLY = process.argv.includes('--apply');
const INCLUDE_006 = process.argv.includes('--include-006');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
const HOLD = 'TI2202607-006';

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====\n`);

  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    orderBy: { name: 'asc' },
  });

  const drafts = docs.filter((d: any) => d.status === 'draft');
  const toConfirm = docs.filter(
    (d: any) => d.status === 'unconfirmed' && (INCLUDE_006 || d.name !== HOLD),
  );
  const held = docs.filter((d: any) => d.status === 'unconfirmed' && !INCLUDE_006 && d.name === HOLD);
  const already = docs.filter((d: any) => d.status === 'confirmed');

  console.log(`DELETE (draft) — ${drafts.length}`);
  drafts.forEach((d: any) =>
    console.log(`   ${d.name}  total=${(d.config as any)?.nettTotal ?? 0}  "${(d.config as any)?.referenceNo ?? ''}"`),
  );

  console.log(`\nCONFIRM (unconfirmed → confirmed) — ${toConfirm.length}`);
  toConfirm.forEach((d: any) =>
    console.log(`   ${d.name}  total=${(d.config as any)?.nettTotal ?? 0}  "${(d.config as any)?.referenceNo ?? ''}"`),
  );

  if (held.length) {
    console.log(`\nHELD BACK — ${held.length}  (duplicate risk; re-run with --include-006 to confirm anyway)`);
    held.forEach((d: any) => console.log(`   ${d.name}  total=${(d.config as any)?.nettTotal ?? 0}`));
  }

  console.log(`\nALREADY CONFIRMED (untouched) — ${already.length}`);
  already.forEach((d: any) => console.log(`   ${d.name}  total=${(d.config as any)?.nettTotal ?? 0}`));

  if (!APPLY) {
    console.log('\n(dry run — nothing written; re-run with --apply)');
    return;
  }

  // ---- back the drafts up before deleting ----
  if (drafts.length) {
    const backup = path.join(os.homedir(), 'Downloads', `osiris-deleted-draft-invoices-${envFile.replace(/^\./, '')}.json`);
    fs.writeFileSync(backup, JSON.stringify(drafts, null, 1));
    console.log(`\nbacked up ${drafts.length} drafts → ${backup}`);
    for (const d of drafts) {
      await prisma.document.delete({ where: { id: d.id } });
    }
    console.log(`deleted ${drafts.length} draft invoices`);
  }

  // ---- confirm ----
  for (const d of toConfirm) {
    const cfg: any = d.config || {};
    await prisma.document.update({
      where: { id: d.id },
      data: {
        status: 'confirmed',
        config: { ...cfg, confirmedAt: new Date().toISOString() } as any,
      },
    });
  }
  console.log(`confirmed ${toConfirm.length} invoices`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
