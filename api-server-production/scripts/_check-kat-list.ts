import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // 1. any credit notes created recently?
  const cns = await prisma.document.findMany({ where: { organizationId: ORG, type: "CREDIT_NOTE", createdAt: { gte: new Date("2026-08-08") } }, select: { name: true, status: true, createdAt: true, config: true } });
  console.log(`credit notes created since 8 Aug: ${cns.length}`);
  for (const d of cns) {
    const c: any = d.config;
    console.log(`  ${d.name} [${d.status}] nett=${c.nettTotal ?? c.total} xeroCreditNoteId=${c.xeroCreditNoteId || "NOT IN XERO"} appliesTo=${c.creditedInvoice || c.reference || ""}`);
  }
  // 2. what became of BI2026080139 (the "held back" one)?
  const d139 = await prisma.document.findFirst({ where: { organizationId: ORG, config: { path: ["renumberedFrom"], equals: "BI2026080139" } }, select: { name: true, config: true } });
  if (d139) { const c: any = d139.config; console.log(`\nBI2026080139 is now ${d139.name}: xeroInvoiceId=${c.xeroInvoiceId ? "PUSHED (draft)" : "not pushed"} nett=${c.nettTotal}`); }
  else console.log("\nBI2026080139: no renumbered doc found");
  // 3. date distribution across our 71
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, select: { name: true, config: true } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  const dates: Record<string, number> = {};
  for (const d of ours) { const dt = String((d.config as any).date).slice(0, 10); dates[dt] = (dates[dt] || 0) + 1; }
  console.log("\ninvoice dates on our 71:", JSON.stringify(dates));
  // 4. recurring template count + any deleted since
  const t = await prisma.recurringInvoiceTemplate.count({ where: { organizationId: ORG } });
  const tInactive = await prisma.recurringInvoiceTemplate.count({ where: { organizationId: ORG, isActive: false } });
  console.log(`recurring templates: ${t} (${tInactive} inactive)`);
  process.exit(0);
})();
