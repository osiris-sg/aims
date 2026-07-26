import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows: any[] = await prod.$queryRaw`
    SELECT c."name" AS account, ROUND(SUM(l."credit"-l."debit")::numeric,2) AS remaining
    FROM "JournalEntryLine" l
    JOIN "JournalEntry" j ON j.id=l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."name" LIKE 'Customer Deposit%'
    GROUP BY 1 HAVING ABS(SUM(l."credit"-l."debit")) > 0.005
    ORDER BY 2 DESC`;
  console.table(rows);
  const [t]: any[] = await prod.$queryRaw`
    SELECT ROUND(SUM(l."credit"-l."debit")::numeric,2) AS total
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."name" LIKE 'Customer Deposit%'`;
  console.log("TOTAL remaining customer credit:", t.total);
  await prod.$disconnect();
})();
