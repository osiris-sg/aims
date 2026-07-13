import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT name, config->'summary' AS summary, config->>'nettTotal' AS nett, config->>'grandTotal' AS grand, config->>'total' AS total
     FROM "Document" WHERE "organizationId" = $1 AND name = 'BI202607046'`,
    BIOFUEL_ORG_ID,
  );
  console.log(JSON.stringify(rows, null, 2));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
