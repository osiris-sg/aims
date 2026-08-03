import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const TRACKER: Array<{ bill: string; amt: number }> = JSON.parse(fs.readFileSync("scripts/_chuanlim-tracker.json", "utf8"));
const REF = "BIPL-JPSG-INV-20260630-0001";
(async () => {
  const trackerBills = [...new Set(TRACKER.map(t => t.bill))];
  // AIMS bills already ref'd to the invoice
  const already = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", config: { path: ["reference"], equals: REF } },
    select: { name: true, config: true },
  });
  const alreadyNames = new Set(already.map(a => a.name));
  const alreadySum = already.reduce((s, a) => s + Number((a.config as any).totalAmount || 0), 0);
  // tracker bills not yet ref'd
  const notRefd: string[] = [];
  const missing: string[] = [];
  for (const n of trackerBills) {
    if (alreadyNames.has(n)) continue;
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: n }, select: { name: true, config: true } });
    if (!b) missing.push(n);
    else notRefd.push(`${n} (ref=${((b.config as any).reference || "").slice(0, 30)}, $${(b.config as any).totalAmount})`);
  }
  console.log(`AIMS bills already ref'd to ${REF}: ${already.length}, cost sum $${alreadySum.toFixed(2)}`);
  console.log(`tracker Chuan Lim bills NOT yet ref'd: ${notRefd.length}`);
  notRefd.forEach(x => console.log("  " + x));
  console.log(`tracker Chuan Lim bills missing from AIMS: ${missing.length} ${missing.join(",")}`);
  // the invoice
  const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: REF }, select: { config: true } });
  const ic: any = inv?.config || {};
  console.log(`\ninvoice ${REF}: xero=${ic.xeroStatus} total=$${ic.totals?.total ?? ic.nettTotal}`);
  (ic.items || []).forEach((it: any) => console.log(`  item: qty=${it.quantity} unit=${it.unitPrice} amt=${it.amount} "${(it.description || "").split("\n")[0].slice(0, 70)}"`));
  await prod.$disconnect();
})();
