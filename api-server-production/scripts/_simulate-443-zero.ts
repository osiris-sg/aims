import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  // ACTUAL posted credits today (GL truth)
  const [cr]: any[] = await prod.$queryRaw`
    SELECT ROUND(SUM(l."credit")::numeric,2) AS cr FROM "JournalEntry" j
    JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND l."credit" > 0`;
  let sim = 0;
  const steps: Array<[string, number]> = [];
  const add = (label: string, v: number) => { sim = R(sim + v); steps.push([label, v]); };

  add("CR: recharge credits already posted", -Number(cr.cr));
  add("CR: void duplicate postings (accountant)", +220);
  // draft recharge invoices that must be approved (credit not yet posted)
  const draftInvs = await prod.document.findMany({ where: { organizationId: ORG, type: "INVOICE", OR: [{ name: { startsWith: "BIPL-JPSG" } }, { name: { startsWith: "JPINV" } }] }, select: { name: true, config: true } });
  let draftCr = 0;
  for (const i of draftInvs) { const c: any = i.config || {}; if (c.xeroStatus === "DRAFT") draftCr += Number(c.totals?.total ?? c.nettTotal ?? 0); }
  add("CR: approve remaining draft recharge invoices", -draftCr);

  // DR: ALL bills ref'd to recharge invoices (recoded to 443, approved, paid)
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { config: true } });
  let billCosts = 0, nBills = 0;
  for (const b of bills) { const c: any = b.config || {}; if (/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || "")) { billCosts += Number(c.totalAmount || 0); nBills++; } }
  add(`DR: all ${nBills} ref'd bills' costs on 443 (recode+approve)`, +billCosts);
  add("DR: missing bill PDFs when they arrive (170118 + 0721-0036 pair + 0038 gap)", +80);
  // CN debits on approval (AR refund CNs, exclude 0152 pending clarification)
  add("DR: approve refund CNs $14+$2+$11", +27);
  add("DR: CN-0152 ($60, refunds 0715-0092) — if approved", +60);

  console.log("SIMULATION — 443 steady state:");
  for (const [l, v] of steps) console.log(`  ${v >= 0 ? "+" : ""}${v.toFixed(2).padStart(10)}  ${l}`);
  console.log(`  ${"─".repeat(30)}\n  FINAL 443: ${sim.toFixed(2)}`);
  await prod.$disconnect();
})();
