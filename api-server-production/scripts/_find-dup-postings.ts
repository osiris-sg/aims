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
    SELECT j.reference AS ref, COUNT(DISTINCT j.id)::int AS journals, SUM(l."credit") AS total_cr
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND l."credit" > 0
    GROUP BY 1 HAVING COUNT(DISTINCT j.id) > 1
    ORDER BY SUM(l."credit") DESC`;
  console.log("invoices posted MORE THAN ONCE into 443:");
  let excess = 0;
  for (const r of rows) {
    const per = Number(r.total_cr) / r.journals;
    excess += per * (r.journals - 1);
    console.log(`  ${String(r.ref).slice(0, 50).padEnd(52)} ×${r.journals} = $${Number(r.total_cr).toFixed(2)} (excess $${(per * (r.journals - 1)).toFixed(2)})`);
  }
  console.log(`\nTOTAL duplicate-posting excess in 443: $${excess.toFixed(2)}`);
  await prod.$disconnect();
})();
