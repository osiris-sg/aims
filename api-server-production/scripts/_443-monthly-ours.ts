import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const d of ["2026-04-30", "2026-05-31", "2026-06-30"]) {
    const [r]: any[] = await prod.$queryRaw`
      SELECT ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
      FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
      JOIN "ChartOfAccount" c ON c.id=l."accountId"
      WHERE j."organizationId"=${ORG} AND c."code"='443' AND j."entryDate" <= ${new Date(d + "T23:59:59Z")}`;
    console.log(`ours ${d} → ${r.net}`);
  }
  await prod.$disconnect();
})();
