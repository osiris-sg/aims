import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // journals referencing the JPSG recharge invoices — payment entries debit an
  // asset account and credit 610 AR. Group by the debited account.
  const rows: any[] = await prod.$queryRaw`
    SELECT c."code" AS code, c."name" AS acct, COUNT(DISTINCT j.id)::int AS journals, ROUND(SUM(l."debit")::numeric,2) AS total_debited
    FROM "JournalEntry" j
    JOIN "JournalEntryLine" l ON l."journalEntryId" = j.id
    JOIN "ChartOfAccount" c ON c.id = l."accountId"
    WHERE j."organizationId"=${ORG} AND j."postedBy"='xero-import'
      AND j."createdAt" > NOW() - INTERVAL '5 hours'
      AND l."debit" > 0
      AND EXISTS (SELECT 1 FROM "JournalEntryLine" l2 JOIN "ChartOfAccount" c2 ON c2.id=l2."accountId"
                  WHERE l2."journalEntryId"=j.id AND c2."code"='610' AND l2."credit" > 0)
    GROUP BY 1, 2 ORDER BY total_debited DESC`;
  console.table(rows);
  await prod.$disconnect();
})();
