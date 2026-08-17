import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BI202607027", "BI202608081"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name, type: "INVOICE" }, select: { id: true, config: true } });
    const c: any = d!.config;
    console.log(`\n===== ${name} sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal} items=${(c.items||[]).length}`);
    for (const it of c.items || []) console.log("  ", JSON.stringify({ code: it.itemCode, qty: it.quantity, up: it.unitPrice, amt: it.amount, disc: it.discount, tax: it.tax ?? it.taxAmount, acct: it.accountCode, desc: (it.description || "").replace(/\n/g, " ¶ ").slice(0, 90) }));
  }
  // template mapping coverage
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, sourceDocumentId: true, lastRunDocumentId: true } });
  const withBoth = tpls.filter(t => t.sourceDocumentId && t.lastRunDocumentId);
  console.log(`\ntemplates: ${tpls.length}; with source+lastRun: ${withBoth.length}`);
  // resolve a sample pair
  const t0 = withBoth[0];
  if (t0) {
    const src = await prisma.document.findUnique({ where: { id: t0.sourceDocumentId! }, select: { name: true } });
    const gen = await prisma.document.findUnique({ where: { id: t0.lastRunDocumentId! }, select: { name: true } });
    console.log(`sample: template "${t0.name}" source=${src?.name} generated=${gen?.name}`);
  }
  process.exit(0);
})();
