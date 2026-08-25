import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, config: true } });
  const needle = "MG20260121";
  for (const d of docs) {
    const c: any = d.config;
    const ref = c.reference || c.referenceNo || c.xeroReference || "";
    if (ref.includes(needle) || ref.includes("Yishun N5C11")) {
      console.log(`${d.name} · ref="${ref}" · xeroNumber=${c.xeroInvoiceNumber} · xeroStatus=${c.xeroStatus} · $${c.nettTotal ?? c.xeroGross}`);
    }
  }
  process.exit(0);
})();
