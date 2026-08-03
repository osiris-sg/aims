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
    SELECT j.reference AS ref, ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443'
    GROUP BY 1`;
  const byInv = new Map<string, number>();
  for (const r of rows) {
    const k = (r.ref || "").match(/(BIPL-JPSG-INV-[\d-]+|JPINV-[0-9A-F-]+|BI\d{9})/i)?.[1] || `(other: ${(r.ref || "").slice(0, 30)})`;
    byInv.set(k, Math.round(((byInv.get(k) || 0) + Number(r.net)) * 100) / 100);
  }
  let total = 0;
  console.log("TRUE net 443 contribution per invoice (negative = credit not yet offset by costs):");
  for (const [k, v] of [...byInv.entries()].sort((a, b) => a[1] - b[1])) {
    total += v;
    if (Math.abs(v) > 0.005) console.log(`  ${String(v.toFixed(2)).padStart(9)}  ${k}`);
  }
  console.log(`  TOTAL: ${total.toFixed(2)}`);
  await prod.$disconnect();
})();
