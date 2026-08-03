import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const R = (n: number) => Math.round(n * 100) / 100;
const FIXES = [
  { name: "JP2604290118", correct: 20.0, wrong: "21.31", invoice: "JPINV-20260430-2CD9AA63" },
  { name: "JP2604300061", correct: 60.0, wrong: "63.40", invoice: "JPINV-20260430-1ED325BD" },
];
(async () => {
  for (const f of FIXES) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: f.name }, select: { id: true, config: true } });
    const c: any = b!.config || {};
    const tax = R((f.correct / 1.09) * 0.09);
    const lines = (c.lines || []).map((l: any) => ({ ...l, amount: f.correct, unitPrice: f.correct }));
    await prod.document.update({
      where: { id: b!.id },
      data: { config: { ...c, totalAmount: f.correct, subtotal: R(f.correct - tax), taxAmount: tax, amountPaid: f.correct, xeroGross: f.correct, xeroAmountPaid: f.correct, lines } },
    });
    await prod.billPayment.updateMany({ where: { organizationId: ORG, billId: b!.id }, data: { amount: f.correct } });
    console.log(`${f.name}: total ${f.wrong} → ${f.correct.toFixed(2)}, payment corrected`);
    // fix the listing line on its invoice
    const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: f.invoice }, select: { id: true, config: true } });
    if (inv) {
      const ic: any = inv.config || {};
      const items = (ic.items || []).map((it: any) =>
        (it.description || "").includes(`${f.name} — ${f.wrong}`)
          ? { ...it, description: it.description.replace(`${f.name} — ${f.wrong}`, `${f.name} — ${f.correct.toFixed(2)}`) }
          : it,
      );
      await prod.document.update({ where: { id: inv.id }, data: { config: { ...ic, items } } });
      console.log(`  listing on ${f.invoice} updated`);
    }
  }
  await prod.$disconnect();
})();
