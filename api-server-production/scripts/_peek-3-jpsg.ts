import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BIPL-JPSG-INV-20260817-0071", "BIPL-JPSG-INV-20260817-0072", "BIPL-JPSG-INV-20260817-0075"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name }, select: { status: true, config: true } });
    if (!d) { console.log(name, "NOT FOUND"); continue; }
    const c: any = d.config;
    console.log(`\n═══ ${name} [${d.status}]`);
    console.log(`  date=${(c.date || "").slice(0,10)} due=${(c.dueDate || "").slice(0,10)} customerId=${c.customerId || c.customer?.id} sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal} taxApplicable=${c.taxApplicable} ref=${(c.reference || c.referenceNo || "").slice(0,60)}`);
    const items: any[] = c.items || [];
    console.log(`  ${items.length} items; amount lines:`);
    for (const it of items) if (Number(it.amount)) console.log(`    $${it.amount} tax=${it.tax ?? it.taxAmount} acct=${it.accountCode} code=${it.itemCode} · ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 90)}`);
    if (c.customerId || c.customer?.id) {
      const cust = await prisma.customer.findUnique({ where: { id: c.customerId || c.customer.id }, select: { name: true, xeroId: true } });
      console.log(`  customer: ${cust?.name} xeroId=${cust?.xeroId ? "✓" : "MISSING"}`);
    }
  }
  process.exit(0);
})();
