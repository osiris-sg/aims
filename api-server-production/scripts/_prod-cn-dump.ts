import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BIPL-JPSG-INV-20260515-0002"]) {
    const cn = await prod.document.findFirst({
      where: { organizationId: ORG, type: "CREDIT_NOTE", name },
      select: { id: true, config: true },
    });
    const c: any = cn?.config || {};
    console.log(`\n=== CN ${name}`);
    console.log("config keys:", Object.keys(c).join(", "));
    for (const k of Object.keys(c)) {
      const v = JSON.stringify(c[k]);
      if (v && v.length < 220) console.log(`  ${k}: ${v}`);
    }
    const items = await prod.documentItem.findMany({ where: { documentId: cn!.id }, select: { description: true, quantity: true, unitPrice: true } });
    console.log("items:", JSON.stringify(items).slice(0, 400));
  }
  // any prod invoices with similar numbers?
  const sims = await prod.$queryRaw`
    SELECT name, type, status FROM "Document"
    WHERE "organizationId"=${ORG} AND (name LIKE 'BIPL-JPSG-INV-20260515%' OR name LIKE 'BIPL-JPSG-INV-20260523%' OR name LIKE 'BIPL-JPSG-INV-20260526%' OR name LIKE 'BIPL-JPSG-INV-20260721-015%' OR name LIKE 'TI2202606%')
    ORDER BY name`;
  console.log("\nsimilar-numbered docs in prod:");
  console.table(sims);
  await prod.$disconnect();
})();
