import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows = await prod.document.findMany({
    where: { organizationId: ORG, name: { contains: "BI202607065" } },
    select: { id: true, name: true, type: true, status: true, createdAt: true, config: true },
  });
  if (!rows.length) { console.log("BI202607065: NOT in AIMS at all"); }
  for (const r of rows) {
    const c: any = r.config || {};
    console.log(`${r.type} "${r.name}" status=${r.status} created=${r.createdAt.toISOString().slice(0, 16)}`);
    console.log(`  xeroInvoiceId=${c.xeroInvoiceId || "none"} xeroStatus=${c.xeroStatus} xeroBalance=${c.xeroBalance} voided=${c.voided}`);
  }
  await prod.$disconnect();
})();
