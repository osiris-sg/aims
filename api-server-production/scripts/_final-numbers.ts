import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const [j30]: any[] = await prod.$queryRaw`
    SELECT ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND j."entryDate" <= '2026-06-30T23:59:59Z'`;
  console.log(`443 as at 30 Jun (accountant's accrual $X): ${j30.net}`);
  const [fytd]: any[] = await prod.$queryRaw`
    SELECT ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND j."entryDate" >= '2026-07-01'`;
  console.log(`443 FY-to-date (1 Jul onward): ${fytd.net}`);
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  const drafts = bills.filter(b => { const c: any = b.config || {}; return /^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || "") && (c.xeroStatus || "DRAFT") === "DRAFT"; });
  console.log(`ref'd bills still DRAFT in Xero: ${drafts.length} → ${drafts.map(d => `${d.name}($${(d.config as any).totalAmount})`).join(", ")}`);
  await prod.$disconnect();
})();
