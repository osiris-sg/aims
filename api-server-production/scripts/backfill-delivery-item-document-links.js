// ═══════════════════════════════════════════════════════════════════════════
// Per-item DO linking backfill (delivery-flow-v2 spec §1, change #4).
//
// The link moved from Delivery.documentId (run-level, now FROZEN) to
// DeliveryItem.documentId. For every run whose legacy documentId is set,
// stamp that DO onto ALL of the run's items that don't have one yet — exact,
// not a guess: under run-level semantics the whole run linked as one unit.
// Runs with a null documentId stay untouched (genuinely unlinked).
//
// Org-agnostic on purpose: the run-level→per-item semantics change applies to
// every existing row, and the copy source is the row's own legacy value.
//
// USAGE (from api-server-production/):
//   [APPLY=1] npx dotenv -e .env -- node scripts/backfill-delivery-item-document-links.js
// DRY RUN by default — prints the full plan. No writes.
// Idempotent: only items with documentId NULL are stamped; re-runs are no-ops.
// ═══════════════════════════════════════════════════════════════════════════
const { PrismaClient } = require('@prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');
const { neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');
neonConfig.webSocketConstructor = ws;
const u = new URL(process.env.DATABASE_URL);
u.searchParams.delete('pool_timeout');
u.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: u.toString() }) });

const APPLY = process.env.APPLY === '1';

(async () => {
  const runs = await p.delivery.findMany({
    where: { documentId: { not: null } },
    select: {
      id: true,
      deliveryNumber: true,
      organizationId: true,
      status: true,
      documentId: true,
      document: { select: { name: true, type: true } },
      items: { select: { id: true, inventoryId: true, documentId: true } },
    },
    orderBy: { deliveryNumber: 'asc' },
  });

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${runs.length} run(s) with a legacy run-level DO link\n`);

  let totalToStamp = 0;
  for (const run of runs) {
    const pending = run.items.filter((i) => i.documentId === null);
    const already = run.items.length - pending.length;
    totalToStamp += pending.length;
    console.log(
      `Delivery #${run.deliveryNumber} (${run.id}) [${run.status}] → DO "${run.document?.name ?? '?'}" (${run.documentId})`,
    );
    console.log(
      `  items: ${run.items.length} total, ${pending.length} to stamp, ${already} already stamped${
        already ? ' (skipped)' : ''
      }`,
    );
    for (const it of pending) console.log(`    - item ${it.id} (unit ${it.inventoryId ?? 'untracked'})`);

    if (APPLY && pending.length) {
      const res = await p.deliveryItem.updateMany({
        where: { id: { in: pending.map((i) => i.id) }, documentId: null },
        data: { documentId: run.documentId },
      });
      console.log(`  ✓ stamped ${res.count} item(s)`);
    }
  }

  console.log(
    `\n${APPLY ? 'DONE' : 'PLAN'}: ${totalToStamp} item(s) across ${runs.length} run(s)${
      APPLY ? '' : ' — re-run with APPLY=1 to execute'
    }`,
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
