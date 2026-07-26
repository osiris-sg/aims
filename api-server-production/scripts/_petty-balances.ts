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
    SELECT c."code" AS code, c."name" AS acct,
      ROUND(SUM(l."debit")::numeric,2) AS money_in, ROUND(SUM(l."credit")::numeric,2) AS money_out,
      ROUND(SUM(l."debit"-l."credit")::numeric,2) AS balance, COUNT(*)::int AS lines
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."name" ILIKE '%petty%'
    GROUP BY 1,2 ORDER BY 1`;
  console.table(rows);
  await prod.$disconnect();
})();
