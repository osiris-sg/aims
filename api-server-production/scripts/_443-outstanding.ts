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
  console.log(`443 GL now: DR ${bal.dr} · CR ${bal.cr} · NET ${bal.net}`);
  // cause 1: ref'd bills still DRAFT in Xero (cost not posted yet)
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  let draftRefd = 0, draftRefdSum = 0, on442Refd = 0, on442Sum = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    const refd = /^(BIPL-JPSG|JPINV)/.test(c.reference || "");
    if (!refd) continue;
    const total = Number(c.totalAmount || 0);
    if ((c.xeroStatus || "DRAFT") === "DRAFT") { draftRefd++; draftRefdSum += total; }
    const acct = (c.lines || [])[0]?.accountId;
    if (acct) {
      const a = await prod.chartOfAccount.findUnique({ where: { id: acct }, select: { code: true } });
      if (a?.code === "442") { on442Refd++; on442Sum += total; }
    }
  }
  console.log(`ref'd bills still DRAFT (cost not in GL yet): ${draftRefd} = $${draftRefdSum.toFixed(2)}`);
  console.log(`ref'd bills coded 442 (cost sits in wrong account): ${on442Refd} = $${on442Sum.toFixed(2)}`);
  // cause 3: unposted recharge invoices (draft AR) — credits not in GL yet
  const invs = await prod.document.findMany({ where: { organizationId: ORG, type: "INVOICE", OR: [{ name: { startsWith: "BIPL-JPSG" } }, { name: { startsWith: "JPINV" } }] }, select: { name: true, config: true } });
  let draftInv = 0, draftInvSum = 0;
  for (const i of invs) {
    const c: any = i.config || {};
    if (c.xeroStatus === "DRAFT") { draftInv++; draftInvSum += Number(c.totals?.total ?? c.nettTotal ?? 0); }
  }
  console.log(`recharge invoices still DRAFT (credit not in GL yet): ${draftInv} = $${draftInvSum.toFixed(2)}`);
  await prod.$disconnect();
})();
