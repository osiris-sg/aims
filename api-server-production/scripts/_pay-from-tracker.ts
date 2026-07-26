import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const MAP: Record<string, string> = JSON.parse(fs.readFileSync("scripts/_tracker-payer-map.json", "utf8"));
(async () => {
  const dennis = await prod.chartOfAccount.findFirst({ where: { organizationId: ORG, code: "106" }, select: { id: true } });
  const eve = await prod.chartOfAccount.findFirst({ where: { organizationId: ORG, code: "106-2" }, select: { id: true } });
  const acctFor = (who: string) => (who === "eve" ? eve!.id : dennis!.id);
  const refFor = (who: string) => (who === "eve" ? "Petty Cash - Eve" : "Petty Cash - Dennis");

  const bills = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } },
    select: { id: true, name: true, config: true },
  });
  const byName = new Map(bills.map(b => [b.name, b]));
  let paidNew = { eve: 0, dennis: 0 }, sum = { eve: 0, dennis: 0 };
  let corrected = 0, alreadyOk = 0, noTracker: string[] = [], trackerNoBill = 0;

  for (const [inv, who] of Object.entries(MAP)) {
    const b = byName.get(inv);
    if (!b) { trackerNoBill++; continue; }
    const c: any = b.config || {};
    const amt = Number(c.totalAmount ?? 0);
    if (!amt) continue;
    const existing = await prod.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id } });
    if (existing) {
      const wantAcct = acctFor(who);
      if (existing.bankAccountId !== wantAcct) {
        await prod.billPayment.update({ where: { id: existing.id }, data: { bankAccountId: wantAcct, reference: refFor(who) } });
        corrected++;
      } else alreadyOk++;
      continue;
    }
    await prod.billPayment.create({
      data: {
        organizationId: ORG, billId: b.id, supplierId: c.supplierId, amount: amt,
        paymentDate: new Date(c.billDate || c.date), paymentMethod: "cash",
        reference: refFor(who),
        notes: `JP pass paid at application via petty cash (${who}), per Pass Application Tracker. GL entry comes from Xero once payment applied there.`,
        bankAccountId: acctFor(who), journalEntryId: null, createdBy: "jp-pass-payment-script",
      },
    });
    await prod.document.update({ where: { id: b.id }, data: { config: { ...c, amountPaid: amt, billStatus: "PAID" } } });
    paidNew[who as "eve" | "dennis"]++; sum[who as "eve" | "dennis"] += amt;
  }
  // bills in AIMS with no tracker entry and no payment yet
  for (const b of bills) {
    if (MAP[b.name]) continue;
    const existing = await prod.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id } });
    if (!existing) noTracker.push(b.name);
  }
  console.log(`new payments: eve=${paidNew.eve} ($${sum.eve.toFixed(2)}) dennis=${paidNew.dennis} ($${sum.dennis.toFixed(2)})`);
  console.log(`existing corrected to tracker payer: ${corrected} · already correct: ${alreadyOk}`);
  console.log(`tracker rows with no AIMS bill: ${trackerNoBill}`);
  console.log(`AIMS JP bills still unpaid (not in tracker): ${noTracker.length}`);
  if (noTracker.length) console.log(noTracker.slice(0, 40).join(", "));
  await prod.$disconnect();
})();
