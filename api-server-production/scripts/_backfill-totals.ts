/** Backfill native total fields (subTotal/gstAmount/nettTotal) from the xero*
 *  variants on imported INVOICE + CREDIT_NOTE docs so the UI shows gross. */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "Document"
     SET config = config || jsonb_build_object(
       'subTotal',  (config->>'xeroSubtotal')::numeric,
       'gstAmount', (config->>'xeroTax')::numeric,
       'nettTotal', (config->>'xeroGross')::numeric)
     WHERE "organizationId" = $1 AND type IN ('INVOICE','CREDIT_NOTE')
       AND config->>'xeroImported' = 'true'
       AND config->>'xeroGross' IS NOT NULL
       AND config->>'nettTotal' IS NULL`,
    BIOFUEL_ORG_ID,
  );
  console.log(`backfilled totals on ${n} docs`);
  const check = await prisma.$queryRawUnsafe<any[]>(
    `SELECT name, config->>'nettTotal' AS gross, config->>'subTotal' AS net
     FROM "Document" WHERE "organizationId" = $1 AND name = 'BI202607046'`,
    BIOFUEL_ORG_ID,
  );
  console.log('BI202607046 check:', check[0]);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
