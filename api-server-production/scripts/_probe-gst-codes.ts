import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const rates = await prisma.taxRate.findMany({ where: { organizationId: BIOFUEL_ORG_ID } });
  console.log('TaxRate rows:', rates.length);
  for (const r of rates) console.log(`  code=${r.code} name=${(r as any).name} rate=${(r as any).rate} direction=${(r as any).direction}`);
  // distinct Xero taxTypes on imported items, with doc type + counts
  const res = await prisma.$queryRawUnsafe<any[]>(
    `SELECT d.type, item->>'taxType' AS taxtype, count(*)::int AS n
     FROM "Document" d, jsonb_array_elements(d.config->'items') item
     WHERE d."organizationId" = $1 AND d.config->>'xeroImported' = 'true'
       AND d.type IN ('INVOICE','BILL','CREDIT_NOTE')
     GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
    BIOFUEL_ORG_ID,
  );
  console.table(res);
  // does documentInfo.taxCode exist anywhere?
  const coded = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*)::int AS coded FROM "Document"
     WHERE "organizationId" = $1 AND config->'documentInfo'->>'taxCode' IS NOT NULL`,
    BIOFUEL_ORG_ID,
  );
  console.log('docs with documentInfo.taxCode:', coded[0].coded);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
