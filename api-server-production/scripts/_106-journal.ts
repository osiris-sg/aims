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
    SELECT j.reference, c."code", c."name", l."debit", l."credit"
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND (j.reference LIKE '%BI202607106%' OR j.description LIKE '%BI202607106%')`;
  console.table(rows);
  await prod.$disconnect();
})();
