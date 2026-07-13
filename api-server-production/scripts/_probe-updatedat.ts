import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT name, "updatedAt", config->>'gstAmount' AS gst, config->>'subTotal' AS sub,
            config->>'nettTotal' AS nett, config->>'xeroGross' AS xerogross,
            jsonb_object_keys(config) AS key
     FROM "Document" WHERE "organizationId" = $1 AND name = 'BI202607046'`,
    BIOFUEL_ORG_ID,
  );
  console.log('updatedAt:', rows[0]?.updatedAt, ' gst:', rows[0]?.gst, ' sub:', rows[0]?.sub, ' nett:', rows[0]?.nett, ' xeroGross:', rows[0]?.xerogross);
  console.log('config keys:', rows.map(r => r.key).join(', '));
  console.log('now:', new Date().toISOString());
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
