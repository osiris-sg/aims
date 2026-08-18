// Discount lines must carry the code of the item they discount (matched by
// account) — template fallback had painted some with the wrong code.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let fixed = 0;
  for (const d of ours) {
    const c: any = d.config;
    const items: any[] = c.items || [];
    let dirty = false;
    for (const it of items) {
      if ((Number(it.amount) || 0) >= 0) continue;
      const mate = items.find(o => (Number(o.amount) || 0) > 0 && o.accountCode === it.accountCode && o.itemCode);
      if (mate && it.itemCode !== mate.itemCode) { console.log(`  ${d.name}: discount on ${it.accountCode} ${it.itemCode} → ${mate.itemCode}`); it.itemCode = mate.itemCode; dirty = true; }
    }
    if (dirty) { fixed++; await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items } } }); }
  }
  console.log(`fixed ${fixed} docs`);
  // show 045's blob for the split decision
  const d45 = ours.find(d => d.name === "BI202608045");
  const c45: any = d45!.config;
  console.log(`\nBI202608045 (${c45.subTotal}/${c45.gstAmount}/${c45.nettTotal}):`);
  for (const it of c45.items || []) console.log(` amt=${it.amount} acct=${it.accountCode} code=${it.itemCode} :: ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 240)}`);
  process.exit(0);
})();
