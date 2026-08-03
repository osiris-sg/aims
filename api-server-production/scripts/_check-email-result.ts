import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const dups = await prod.document.findMany({
    where: { organizationId: ORG, name: "JPINV-20260430-2CD9AA63" },
    select: { id: true, createdAt: true, config: true },
    orderBy: { createdAt: "asc" },
  });
  for (const d of dups) {
    const c: any = d.config || {};
    console.log(`${d.id.slice(0, 8)} created=${d.createdAt.toISOString()} xero=${c.xeroInvoiceId ? c.xeroStatus : "NO"} items=${(c.items || []).length} pdf=${c.sourceFileUrl ? "yes" : "no"} listing=${(c.items || []).some((i: any) => /JP26\d{8}/.test(i.description || ""))}`);
  }
  const recentBills: any[] = await prod.$queryRaw`
    SELECT name, "createdAt", config->>'reference' AS ref FROM "Document"
    WHERE "organizationId"=${ORG} AND type='BILL' AND "updatedAt" > NOW() - INTERVAL '2 hours'
    ORDER BY name`;
  console.log("\nbills touched by the email:");
  console.table(recentBills.map(b => ({ name: b.name, created: b.createdAt.toISOString().slice(0, 16), ref: (b.ref || "").slice(0, 40) })));
  await prod.$disconnect();
})();
