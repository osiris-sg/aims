import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  const acct = new Map<string, string>();
  const codeOf = async (id: string) => {
    if (!acct.has(id)) { const a = await prod.chartOfAccount.findUnique({ where: { id }, select: { code: true } }); acct.set(id, a?.code || "?"); }
    return acct.get(id)!;
  };
  let moviPosted = 0, moviDraft = 0, nPosted = 0, nDraft = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    if (!/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || "")) continue;
    const code = c.lines?.[0]?.accountId ? await codeOf(c.lines[0].accountId) : c.lines?.[0]?.accountCode;
    if (code === "443") continue;
    const total = Number(c.totalAmount || 0);
    if ((c.xeroStatus || "DRAFT") === "DRAFT") { moviDraft += total; nDraft++; }
    else { moviPosted += total; nPosted++; }
  }
  const [bal]: any[] = await prod.$queryRaw`
    SELECT ROUND(SUM(l."debit"-l."credit")::numeric,2) AS net
    FROM "JournalEntryLine" l JOIN "JournalEntry" j ON j.id=l."journalEntryId"
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443'`;
  const now = Number(bal.net);
  console.log(`443 now: ${now}`);
  console.log(`ref'd bills on 442, POSTED in Xero: ${nPosted} bills, $${moviPosted.toFixed(2)} → moves into 443 on recode`);
  console.log(`ref'd bills on 442, still DRAFT: ${nDraft} bills, $${moviDraft.toFixed(2)} → moves when approved`);
  console.log(`\nprojected 443 after recode (posted only): ${(now + moviPosted).toFixed(2)}`);
  console.log(`projected after drafts also approved:     ${(now + moviPosted + moviDraft).toFixed(2)}`);
  console.log(`(+$20 when JP2607170118 arrives)`);
  await prod.$disconnect();
})();
