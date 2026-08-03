import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // CR side: unique posted recharge invoices (dedup by xeroInvoiceId), non-disposal
  const invs = await prod.document.findMany({ where: { organizationId: ORG, type: "INVOICE", OR: [{ name: { startsWith: "BIPL-JPSG" } }, { name: { startsWith: "JPINV" } }, { name: "BI202607106" }] }, select: { name: true, config: true } });
  const seen = new Set<string>();
  const credits: Array<{ name: string; amt: number }> = [];
  for (const i of invs) {
    const c: any = i.config || {};
    if (!c.xeroInvoiceId || seen.has(c.xeroInvoiceId)) continue;
    if (!["PAID", "AUTHORISED"].includes(c.xeroStatus)) continue;
    if (/soil|disposal|tonne/i.test(JSON.stringify(c.items || []))) continue;
    seen.add(c.xeroInvoiceId);
    credits.push({ name: i.name, amt: Number(c.xeroGross ?? c.totals?.total ?? c.nettTotal ?? 0) });
  }
  const X = credits.reduce((s, x) => s + x.amt, 0);
  // DR side: ref'd bills posted
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  const covered = new Map<string, number>();
  let Y = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    if (!/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || "")) continue;
    if (!c.xeroBillId || (c.xeroStatus || "DRAFT") === "DRAFT") continue;
    Y += Number(c.totalAmount || 0);
    covered.set(c.reference, (covered.get(c.reference) || 0) + Number(c.totalAmount || 0));
  }
  console.log(`CR posted invoices X = ${X.toFixed(2)} · DR posted bills Y = ${Y.toFixed(2)} · CNs 87 · MJ 20`);
  console.log(`identity: X − Y − 87 − 20 = ${(X - Y - 107).toFixed(2)} (should ≈ 180)`);
  console.log("\nper-invoice: credit vs covered-by-posted-bills (non-zero gaps):");
  for (const cr of credits.sort((a, b) => b.amt - a.amt)) {
    const cov = covered.get(cr.name) || 0;
    const gap = Math.round((cr.amt - cov) * 100) / 100;
    if (Math.abs(gap) > 0.005) console.log(`  ${cr.name.padEnd(32)} $${cr.amt.toFixed(2).padStart(8)} − bills $${cov.toFixed(2).padStart(8)} = $${gap.toFixed(2)}`);
  }
  await prod.$disconnect();
})();
