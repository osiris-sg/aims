import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202608079" }, select: { id: true, config: true } });
  const c: any = d!.config;
  console.log("BI202608079:", (c.customerName || c.customer?.name), "$" + c.nettTotal);
  console.log("  lineFormat:", c.lineFormat, "| alphaRenumberedFrom:", c.alphaRenumberedFrom, "| renumberedFrom:", c.renumberedFrom, "| rolledFrom:", c.rolledFrom);
  console.log("  ref:", c.reference || c.referenceNo);
  // template chain
  const tpl = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, lastRunDocumentId: d!.id }, select: { name: true, sourceDocumentId: true } });
  if (tpl) {
    const src = await prisma.document.findUnique({ where: { id: tpl.sourceDocumentId! }, select: { name: true, config: true } });
    const sc: any = src?.config;
    console.log("  template:", tpl.name);
    console.log("  JULY SOURCE:", src?.name, "$" + (sc?.nettTotal ?? sc?.xeroGross), "·", (sc?.xeroReference || "").slice(0, 80));
  }
  process.exit(0);
})();
