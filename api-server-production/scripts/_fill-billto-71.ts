// Fill empty billTo/customerAddress on the 71 drafts from the (now-fixed)
// customer master. Fill-empty only — hand-entered values stay.
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
  const custIds = [...new Set(ours.map(d => (d.config as any).customerId).filter(Boolean))] as string[];
  const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true, address: true } });
  const byId = new Map(custs.map(c => [c.id, c]));
  let changed = 0;
  for (const d of ours) {
    const c: any = d.config;
    const cust = byId.get(c.customerId);
    if (!cust?.address) continue;
    let dirty = false;
    const cfg: any = { ...c };
    if (!cfg.billTo) { cfg.billTo = `${cust.name}\n${cust.address.replace(/, /g, "\n")}`; dirty = true; }
    if (!cfg.customerAddress) { cfg.customerAddress = cust.address; dirty = true; }
    if (dirty) { changed++; await prisma.document.update({ where: { id: d.id }, data: { config: cfg } }); }
  }
  console.log(`filled billTo/address on ${changed}/${ours.length} drafts`);
  process.exit(0);
})();
