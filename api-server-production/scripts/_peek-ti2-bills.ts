import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["TI2202607-004", "TI2202607-006"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "BILL", name }, select: { config: true, status: true } });
    const c: any = d!.config;
    console.log(`\n═══ ${name} [${d!.status}]`);
    console.log("  top keys:", Object.keys(c).join(",").slice(0, 300));
    for (const k of ["supplierId", "supplierName", "supplier", "vendorName", "billDate", "dueDate", "totalAmount", "gstAmount", "nettTotal", "subTotal", "taxApplicable", "billStatus", "reference", "referenceNo"]) {
      const v = c[k]; if (v !== undefined) console.log(`  ${k} =`, JSON.stringify(v)?.slice(0, 120));
    }
    if (c.supplierId) {
      const sup = await prisma.supplier.findUnique({ where: { id: c.supplierId }, select: { name: true, xeroId: true } as any }).catch(() => null);
      console.log("  supplier row:", (sup as any)?.name, "xeroId:", (sup as any)?.xeroId || "MISSING");
    }
  }
  process.exit(0);
})();
