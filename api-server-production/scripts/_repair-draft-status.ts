/** One-off: restore status='draft' on invoices that are DRAFT/SUBMITTED in
 *  Xero but were stamped pending_payment/paid by the balance updater. */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "Document" SET status = 'draft'
     WHERE "organizationId" = $1 AND type = 'INVOICE'
       AND config->>'xeroStatus' IN ('DRAFT','SUBMITTED')
       AND status <> 'draft'`,
    BIOFUEL_ORG_ID,
  );
  console.log(`repaired ${n} invoice(s) back to draft`);
  const check = await prisma.$queryRawUnsafe<any[]>(
    `SELECT config->>'xeroStatus' AS xero, status::text AS aims, count(*)::int AS n
     FROM "Document" WHERE "organizationId" = $1 AND type = 'INVOICE'
     GROUP BY 1, 2 ORDER BY 1, 2`,
    BIOFUEL_ORG_ID,
  );
  console.table(check);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
