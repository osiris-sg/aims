import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const [bal]: any[] = await prod.$queryRaw`
    SELECT ROUND(SUM(l."debit")::numeric,2) AS dr, ROUND(SUM(l."credit")::numeric,2) AS cr, ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443'`;
  console.log(`443 GL: DR ${bal.dr} · CR ${bal.cr} · NET ${bal.net}`);
  const inv = await prod.document.findFirst({
    where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202607106" } },
    select: { name: true, status: true, config: true },
  });
  const c: any = inv?.config || {};
  console.log(`BI202607106: ${inv ? `${inv.status} · xero=${c.xeroStatus} · total=$${c.totals?.total ?? c.nettTotal} · items[0].acct=${c.items?.[0]?.accountCode}` : "NOT in AIMS"}`);
  await prod.$disconnect();
})();
