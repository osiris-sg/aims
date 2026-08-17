import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  const custIds = [...new Set(ours.map(d => (d.config as any).customerId).filter(Boolean))] as string[];
  const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } });
  const nameById = new Map(custs.map(c => [c.id, c.name]));
  const rows = ours.map(d => ({ no: d.name!, cust: nameById.get((d.config as any).customerId) || "?", nett: (d.config as any).nettTotal }));
  rows.sort((a, b) => a.cust.toLowerCase().localeCompare(b.cust.toLowerCase()) || a.no.localeCompare(b.no));
  let last = ""; let count = 0; let sum = 0;
  for (const r of rows) {
    if (r.cust !== last) { console.log(`\n${r.cust}`); last = r.cust; }
    console.log(`  ${r.no}  $${Number(r.nett).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    count++; sum += Number(r.nett) || 0;
  }
  console.log(`\nTOTAL ${count} drafts $${sum.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  process.exit(0);
})();
