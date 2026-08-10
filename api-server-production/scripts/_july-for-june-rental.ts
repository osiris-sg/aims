import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const JUNE = /(june\s*20?26|jun[\s'-]*26|jun\s*2026|01\/0?6\/(20)?26|30\/0?6\/(20)?26|0?6\/2026|2026-06|june)/i;
const RENTAL = /rental|rent of|hire|lease/i;
(async () => {
  const invs = await prod.document.findMany({
    where: { organizationId: ORG, type: "INVOICE" },
    select: { name: true, status: true, config: true },
  });
  const hits: any[] = [];
  for (const inv of invs) {
    const c: any = inv.config || {};
    const dateStr = c.date || c.documentInfo?.date || "";
    const d = new Date(dateStr);
    if (!(d >= new Date("2026-07-01") && d < new Date("2026-08-01"))) continue;
    const items: any[] = c.items || [];
    const DISP = /disposal|soil|tonne|wharfage/i;
    const JUNEP = /(01\/0?6\/(20)?26|30\/0?6\/(20)?26|june\s*20?26|jun[e']?\s*26)/i;
    if (items.some((it: any) => DISP.test(it.description || ""))) continue;
    const juneItem = items.find((it: any) => JUNEP.test(it.description || ""));
    const rentalItem = items.find((it: any) => RENTAL.test(it.description || ""));
    const juneRentalItem = juneItem && rentalItem ? (JUNEP.test(rentalItem.description) ? rentalItem : juneItem) : null;
    if (juneRentalItem) {
      hits.push({
        invoice: inv.name,
        date: dateStr.slice(0, 10),
        customer: (c.customerName || c.customer?.name || "").slice(0, 30),
        total: Number(c.totals?.total ?? c.nettTotal ?? c.xeroGross ?? 0),
        status: c.xeroStatus || inv.status,
        period: ((juneRentalItem.description || "").match(/(from|period)[^|]{0,45}/i)?.[0] || "").slice(0, 45),
        desc: (juneRentalItem.description || "").slice(0, 70).replace(/\n/g, " "),
      });
    }
  }
  hits.sort((a, b) => a.invoice.localeCompare(b.invoice));
  console.log(`invoices dated July 2026 billing JUNE rental: ${hits.length}`);
  let sum = 0;
  hits.forEach(h => { sum += h.total; console.log(`  ${h.invoice.padEnd(16)} ${h.date} · $${String(h.total.toFixed(2)).padStart(11)} · ${h.status.padEnd(12)} · ${h.customer.padEnd(30)} · "${h.desc}"`); });
  console.log(`TOTAL: $${sum.toFixed(2)}`);
  await prod.$disconnect();
})();
