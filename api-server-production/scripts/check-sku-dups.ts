import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Find any (sku, organizationId) pairs that appear more than once —
  // these would block the incoming @@unique([sku, organizationId]) constraint.
  const rows: Array<{ sku: string; organizationId: string; n: bigint }> =
    await p.$queryRaw`
      SELECT "sku", "organizationId", COUNT(*) AS n
      FROM "Inventory"
      WHERE "sku" IS NOT NULL
      GROUP BY "sku", "organizationId"
      HAVING COUNT(*) > 1
      ORDER BY n DESC
      LIMIT 50`;
  const total = await p.inventory.count();
  if (rows.length === 0) {
    console.log(`OK — no duplicate (sku, organizationId). Inventory rows: ${total}. Safe to add unique constraint.`);
  } else {
    console.log(`BLOCKED — ${rows.length} duplicate (sku, organizationId) group(s). Constraint add WILL fail:`);
    for (const r of rows) console.log(`  sku=${r.sku}  org=${r.organizationId}  count=${r.n}`);
  }
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
