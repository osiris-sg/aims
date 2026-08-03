import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const code of ["442", "443"]) {
    const [acct]: any[] = await prod.$queryRaw`
      SELECT c."name", c."accountType" FROM "ChartOfAccount" c WHERE c."organizationId"=${ORG} AND c."code"=${code}`;
    const [sums]: any[] = await prod.$queryRaw`
      SELECT ROUND(SUM(l."debit")::numeric,2) AS dr, ROUND(SUM(l."credit")::numeric,2) AS cr,
             ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net, COUNT(*)::int AS lines,
             MIN(j."entryDate")::date AS first, MAX(j."entryDate")::date AS last
      FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
      JOIN "ChartOfAccount" c ON c.id=l."accountId"
      WHERE j."organizationId"=${ORG} AND c."code"=${code}`;
    const byMonth: any[] = await prod.$queryRaw`
      SELECT TO_CHAR(j."entryDate",'YYYY-MM') AS month,
             ROUND(SUM(l."debit")::numeric,2) AS dr, ROUND(SUM(l."credit")::numeric,2) AS cr
      FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
      JOIN "ChartOfAccount" c ON c.id=l."accountId"
      WHERE j."organizationId"=${ORG} AND c."code"=${code}
      GROUP BY 1 ORDER BY 1`;
    console.log(`\n===== ${code} — ${acct?.name} (${acct?.accountType})`);
    console.log(`  DR (costs in) $${sums.dr} · CR (recharged out) $${sums.cr} · NET $${sums.net} · ${sums.lines} lines · ${sums.first?.toISOString?.().slice(0,10) ?? sums.first} → ${sums.last?.toISOString?.().slice(0,10) ?? sums.last}`);
    console.table(byMonth);
  }
  await prod.$disconnect();
})();
