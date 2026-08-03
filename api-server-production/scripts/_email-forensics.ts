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
  console.log("JPINV-20260430-2CD9AA63 rows:", dups.length);
  for (const d of dups) {
    const c: any = d.config || {};
    console.log(`  ${d.id.slice(0, 8)} created=${d.createdAt.toISOString().slice(0, 16)} xero=${c.xeroInvoiceId ? c.xeroStatus : "NO"} listing=${(c.items || []).some((i: any) => /JP26\d{8}/.test(i.description || ""))} pdf=${c.sourceFileUrl ? "yes" : "no"}`);
  }
  const logs: any[] = await prod.$queryRaw`
    SELECT "createdAt", subject, status, "attachmentCount", reason FROM "EmailIngestLog"
    WHERE "organizationId"=${ORG} AND "createdAt" > NOW() - INTERVAL '3 hours' ORDER BY "createdAt"`;
  console.log("\nemails in last 3h:");
  logs.forEach(l => console.log(`  ${l.createdAt.toISOString().slice(11, 16)} [${l.status}] att=${l.attachmentCount} "${(l.subject || "").slice(0, 70)}" ${l.reason || ""}`));
  const stamped: any[] = await prod.$queryRaw`
    SELECT config->>'reference' AS ref, COUNT(*)::int AS n FROM "Document"
    WHERE "organizationId"=${ORG} AND type='BILL' AND "updatedAt" > NOW() - INTERVAL '3 hours'
    GROUP BY 1 ORDER BY n DESC LIMIT 10`;
  console.log("\nbills updated in last 3h, by current ref:");
  console.table(stamped);
  await prod.$disconnect();
})();
