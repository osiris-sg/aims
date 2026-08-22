// Inventory AIMS-born confirmed docs not yet in Xero (the 25 GB/UT bills + any 19 Aug docs).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // local journals with source docs → those docs, where doc not linked to Xero
  const live = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, status: "POSTED", OR: [{ postedBy: null }, { NOT: { postedBy: "xero-import" } }], sourceDocumentId: { not: null } },
    select: { sourceDocumentId: true, journalNumber: true },
  } as any);
  const docIds = [...new Set((live as any[]).map(j => j.sourceDocumentId))];
  const docs = await prisma.document.findMany({ where: { id: { in: docIds } }, select: { id: true, name: true, type: true, status: true, config: true } });
  const toPush: any[] = [];
  for (const d of docs) {
    const c: any = d.config;
    if (c.xeroBillId || c.xeroInvoiceId) continue; // already in Xero
    toPush.push(d);
  }
  console.log(`${toPush.length} docs need pushing:`);
  for (const d of toPush) {
    const c: any = d.config;
    const supName = c.supplier?.name || c.supplierName || c.customerName || c.customer?.name || "?";
    console.log(`  ${d.name} [${d.type}/${d.status}] $${c.totalAmount ?? c.nettTotal} · ${supName.slice(0, 35)} · date=${(c.billDate || c.date || "").slice(0, 10)} · supplierId=${c.supplierId?.slice(0, 8) || "—"}`);
  }
  // supplier xeroId coverage
  const supIds = [...new Set(toPush.map(d => (d.config as any).supplierId).filter(Boolean))] as string[];
  const sups = await prisma.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true, xeroId: true } as any });
  console.log(`\nsuppliers: ${sups.length}, missing xeroId: ${(sups as any[]).filter(s => !s.xeroId).map(s => s.name).join(", ") || "none"}`);
  process.exit(0);
})();
