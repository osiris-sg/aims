import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: "BI202608079", type: "INVOICE" }, select: { id: true } });
  const tpl = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, lastRunDocumentId: d!.id }, select: { sourceDocumentId: true } });
  console.log("has template mapping:", !!tpl, tpl?.sourceDocumentId?.slice(0, 8));
  if (tpl) { const s = await prisma.document.findUnique({ where: { id: tpl.sourceDocumentId! }, select: { name: true } }); console.log("source:", s?.name); }
  process.exit(0);
})();
