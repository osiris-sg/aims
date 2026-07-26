import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const TR: Record<string, { who: string; amt: number | null }> = JSON.parse(fs.readFileSync("scripts/_tracker-full.json", "utf8"));
(async () => {
  let match = 0, amtMismatch: string[] = [], payerMismatch: string[] = [], missingPay = 0;
  let aimsEve = 0, aimsDennis = 0, sumEve = 0, sumDennis = 0;
  for (const [inv, t] of Object.entries(TR)) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: inv }, select: { id: true, config: true } });
    if (!d) continue;
    const c: any = d.config || {};
    const pay = await prod.billPayment.findFirst({ where: { organizationId: ORG, billId: d.id }, select: { amount: true, reference: true } });
    if (!pay) { missingPay++; continue; }
    const payer = (pay.reference || "").includes("Eve") ? "eve" : "dennis";
    if (payer === "eve") { aimsEve++; sumEve += Number(pay.amount); } else { aimsDennis++; sumDennis += Number(pay.amount); }
    if (t.who && payer !== t.who) payerMismatch.push(`${inv}: tracker=${t.who} aims=${payer}`);
    if (t.amt != null && Math.abs(Number(pay.amount) - t.amt) > 0.01) amtMismatch.push(`${inv}: tracker=$${t.amt} aims-paid=$${pay.amount}`);
    else match++;
  }
  console.log(`tracker rows checked: ${Object.keys(TR).length} · fully matching: ${match} · no AIMS payment: ${missingPay}`);
  console.log(`AIMS payments — eve: ${aimsEve} ($${sumEve.toFixed(2)}) · dennis: ${aimsDennis} ($${sumDennis.toFixed(2)})`);
  console.log(`payer mismatches: ${payerMismatch.length}`); payerMismatch.forEach(m => console.log("  " + m));
  console.log(`amount mismatches: ${amtMismatch.length}`); amtMismatch.forEach(m => console.log("  " + m));
  await prod.$disconnect();
})();
