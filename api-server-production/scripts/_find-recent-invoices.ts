import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prod.document.findMany({
    where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, createdAt: true, config: true },
  });
  console.log(`${docs.length} invoices created since 8 Aug`);
  const templates = await prod.recurringInvoiceTemplate.count({ where: { organizationId: ORG } });
  console.log(`recurring templates in org: ${templates}`);
  for (const d of docs.slice(0, 8)) {
    const c: any = d.config;
    console.log(`\n${d.name} [${d.status}] created ${d.createdAt.toISOString().slice(0,16)} xeroImported=${!!c.xeroImported}`);
    console.log(`  date=${c.date} customer=${c.customerName || c.customer?.name} nett=${c.nettTotal ?? c.grossTotal} gst=${c.gstAmount} ref=${(c.referenceNo || "").slice(0,60)}`);
    const items = (c.items || []);
    console.log(`  items=${items.length}; first amt lines:`, items.filter((it: any) => (it.amount || it.unitPrice)).slice(0, 2).map((it: any) => ({ amt: it.amount, up: it.unitPrice, tax: it.tax, acct: it.accountCode, desc: (it.description || "").slice(0, 50) })));
  }
  console.log("\nall names:", docs.map(d => d.name).join(","));
  process.exit(0);
})();
