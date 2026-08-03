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
    SELECT CASE WHEN j."entryDate" <= NOW() THEN 'up to today' ELSE 'future-dated' END AS bucket,
           ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net, COUNT(*)::int AS lines,
           MIN(j."entryDate")::date AS first, MAX(j."entryDate")::date AS last
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443'
    GROUP BY 1`;
  console.table(rows);
  const fut: any[] = await prod.$queryRaw`
    SELECT j.reference, j."entryDate"::date AS d, ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND j."entryDate" > NOW()
    GROUP BY 1,2 ORDER BY 2 LIMIT 12`;
  console.table(fut);
  await prod.$disconnect();
})();
