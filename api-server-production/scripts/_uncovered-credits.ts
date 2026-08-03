import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const invs = await prod.document.findMany({
    where: { organizationId: ORG, type: "INVOICE", OR: [{ name: { startsWith: "BIPL-JPSG" } }, { name: { startsWith: "JPINV" } }, { name: "BI202607106" }] },
    select: { name: true, config: true },
  });
  const cns = await prod.document.findMany({ where: { organizationId: ORG, type: "CREDIT_NOTE", name: { startsWith: "BIPL" } }, select: { config: true } });
  const cnByTarget = new Map<string, number>();
  for (const cn of cns) {
    const c: any = cn.config || {};
    const ref = (c.documentInfo?.reference || "").match(/BIPL-JPSG-INV-[\d-]+/)?.[0];
    if (ref && ["PAID", "AUTHORISED"].includes(c.xeroStatus)) cnByTarget.set(ref, (cnByTarget.get(ref) || 0) + Number(c.totals?.total ?? 0));
  }
  let totalGap = 0;
  console.log("posted invoices with credits NOT covered by linked bills:");
  for (const inv of invs) {
    const c: any = inv.config || {};
    if (!["PAID", "AUTHORISED"].includes(c.xeroStatus)) continue;
    if (/soil|disposal|tonne/i.test(JSON.stringify(c.items || []))) continue;
    const total = Number(c.totals?.total ?? c.nettTotal ?? 0);
    const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", config: { path: ["reference"], equals: inv.name } }, select: { config: true } });
    const covered = bills.reduce((s, b) => s + Number((b.config as any).totalAmount || 0), 0);
    const cnAmt = cnByTarget.get(inv.name) || 0;
    const gap = Math.round((total - covered - cnAmt) * 100) / 100;
    if (Math.abs(gap) > 0.005) {
      totalGap += gap;
      console.log(`  ${inv.name.padEnd(30)} invoice $${total.toFixed(2).padStart(8)} − bills $${covered.toFixed(2).padStart(8)}${cnAmt ? ` − CN $${cnAmt}` : ""} = uncovered $${gap.toFixed(2)}  · cust=${(c.customerName || c.customer?.name || "").slice(0, 22)}`);
    }
  }
  console.log(`TOTAL uncovered: $${totalGap.toFixed(2)}`);
  await prod.$disconnect();
})();
