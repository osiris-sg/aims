import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const LIST = `JP2604100055 JP2604150047 JP2604150059 JP2604150065 JP2604150119 JP2604150121 JP2604150122 JP2604150125 JP2604160066 JP2604200077 JP2604240090 JP2604250007 JP2604270072 JP2604270078 JP2604270110 JP2604270111 JP2604270115 JP2604270116 JP2604270117 JP2604270118 JP2604270178 JP2604270179 JP2604270180 JP2604270181 JP2604270182 JP2604270184 JP2604290130 JP2604300017 JP2605020017 JP2605020021 JP2605020025 JP2605020026 JP2605020028 JP2605020030 JP2605160024 JP2605160026 JP2606010011 JP2606230023`.split(/\s+/);
(async () => {
  const dennis = await prod.chartOfAccount.findFirst({ where: { organizationId: ORG, code: "106" }, select: { id: true, name: true } });
  if (!dennis) throw new Error("Petty Cash - Dennis (106) not found");
  const bills = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", name: { in: LIST } },
    select: { id: true, name: true, config: true },
  });
  let paid = 0, already = 0, total = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    const amt = Number(c.totalAmount ?? 0);
    if (!amt) { console.log(`? ${b.name}: no total`); continue; }
    if (Number(c.amountPaid || 0) >= amt) { already++; continue; }
    const existing = await prod.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id } });
    if (existing) { already++; continue; }
    await prod.billPayment.create({
      data: {
        organizationId: ORG,
        billId: b.id,
        supplierId: c.supplierId,
        amount: amt,
        paymentDate: new Date(c.billDate || c.date),
        paymentMethod: "cash",
        reference: "Petty Cash - Dennis",
        notes: "JP pass paid at application via petty cash (Dennis). GL entry comes from Xero once payment applied there.",
        bankAccountId: dennis.id,
        journalEntryId: null,
        createdBy: "jp-pass-payment-script",
      },
    });
    await prod.document.update({
      where: { id: b.id },
      data: { config: { ...c, amountPaid: amt, billStatus: "PAID" } },
    });
    paid++; total += amt;
  }
  console.log(`paid: ${paid} bills · $${total.toFixed(2)} from ${dennis.name} · already-paid/skipped: ${already} · found ${bills.length}/${LIST.length} (13 still missing from AIMS)`);
  await prod.$disconnect();
})();
