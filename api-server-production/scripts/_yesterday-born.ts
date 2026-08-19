// Inventory AIMS-born bills + invoices created 18 Aug SGT (audit + doc scan).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const start = new Date("2026-08-18T00:00:00+08:00"), end = new Date("2026-08-19T00:00:00+08:00");
  const logs = await prisma.auditLog.findMany({ where: { organizationId: ORG, action: "CREATED", resource: "document", createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" }, select: { createdAt: true, resourceName: true, userName: true } });
  console.log(`${logs.length} CREATED events on 18 Aug:`);
  for (const l of logs) console.log(`  ${l.createdAt.toISOString().slice(11, 16)}Z ${l.resourceName} · ${l.userName || "?"}`);
  // the docs themselves
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, createdAt: { gte: start, lt: end }, type: { in: ["INVOICE", "BILL", "CREDIT_NOTE"] } }, orderBy: { createdAt: "asc" }, select: { name: true, type: true, status: true, config: true } });
  const born = docs.filter(d => { const c: any = d.config; return !c?.xeroImported && !c?.xeroSyncedBy; });
  console.log(`\n${born.length} AIMS-born bills/invoices on 18 Aug:`);
  for (const d of born) {
    const c: any = d.config;
    console.log(`\n  ${d.name} [${d.type}/${d.status}] $${c.nettTotal ?? c.grossTotal ?? c.totalAmount ?? "?"} · cust=${(c.customerName || c.customer?.name || c.supplierName || "?").slice(0, 35)} · date=${(c.date || c.billDate || "").slice(0, 10)}`);
    for (const it of (c.items || []).filter((x: any) => Number(x.amount))) console.log(`     $${it.amount} tax=${it.tax ?? it.taxAmount} acct=${it.accountCode} code=${it.itemCode} · ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 70)}`);
  }
  process.exit(0);
})();
