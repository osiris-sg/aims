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
  const bills = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } },
    select: { id: true, name: true, config: true },
  });
  const targets = bills.filter(b => !((b.config as any)?.reference || "").startsWith("BIPL-JPSG"));
  let done = 0, sumTotal = 0, sumTax = 0;
  for (const b of targets) {
    const c: any = b.config || {};
    const total = Number(c.totalAmount ?? c.xeroGross ?? 0);
    if (!total) { console.log(`? ${b.name}: no total, skipped`); continue; }
    const tax = R((total / 1.09) * 0.09);
    await prod.document.update({
      where: { id: b.id },
      data: { config: { ...c, amountsAre: "INCLUSIVE", taxAmount: tax, subtotal: R(total - tax) } },
    });
    done++; sumTotal += total; sumTax += tax;
  }
  console.log(`AIMS updated: ${done}/${targets.length} bills → GST-inclusive 9%`);
  console.log(`totals unchanged: $${R(sumTotal)} · input GST now recorded: $${R(sumTax)}`);
  // sample
  const s = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: "JP2607070051" }, select: { config: true } });
  const sc: any = s?.config;
  console.log(`sample JP2607070051: total=${sc.totalAmount} subtotal=${sc.subtotal} tax=${sc.taxAmount} amountsAre=${sc.amountsAre}`);
  await prod.$disconnect();
})();
