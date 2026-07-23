import { createScriptPrisma } from "./xero-migration/_common";
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const prisma = createScriptPrisma();
  const groups: any[] = await prisma.$queryRaw`
    SELECT COALESCE("postedBy",'(null)') AS src, COUNT(*)::int AS n,
           MIN("entryDate")::date AS first, MAX("entryDate")::date AS last
    FROM "JournalEntry" WHERE "organizationId" = ${ORG}
    GROUP BY 1 ORDER BY n DESC`;
  console.table(groups);
  const lines: any[] = await prisma.$queryRaw`
    SELECT coa."code" AS code, coa."name" AS name,
           ROUND(SUM(l."debit" - l."credit")::numeric,2) AS net, COUNT(*)::int AS lines
    FROM "JournalEntryLine" l
    JOIN "JournalEntry" j ON j.id = l."journalEntryId"
    JOIN "ChartOfAccount" coa ON coa.id = l."accountId"
    WHERE j."organizationId" = ${ORG} AND COALESCE(j."postedBy",'x') <> 'xero-import'
    GROUP BY 1,2 HAVING ABS(SUM(l."debit" - l."credit")) > 0.005
    ORDER BY ABS(SUM(l."debit" - l."credit")) DESC LIMIT 25`;
  console.table(lines);
  await prisma.$disconnect();
})();
