import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const local: any[] = await prod.$queryRaw`
    SELECT COALESCE("postedBy",'(null)') AS src, COUNT(*)::int AS n, MIN("entryDate")::date AS first, MAX("entryDate")::date AS last
    FROM "JournalEntry" WHERE "organizationId"=${ORG} AND COALESCE("postedBy",'') <> 'xero-import'
    GROUP BY 1`;
  console.log("LOCAL (non-Xero) journals in prod:");
  console.table(local);
  const locLines: any[] = await prod.$queryRaw`
    SELECT c."code", c."name", ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND COALESCE(j."postedBy",'') <> 'xero-import'
    GROUP BY 1,2 HAVING ABS(SUM(l."debit"-l."credit")) > 0.005 ORDER BY ABS(SUM(l."debit"-l."credit")) DESC LIMIT 12`;
  console.log("their GL effect by account:");
  console.table(locLines);
  await prod.$disconnect();
})();
