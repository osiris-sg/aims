import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const logs: any[] = await prod.$queryRaw`
    SELECT "createdAt", subject, status, "attachmentCount", LEFT(reason, 400) AS reason
    FROM "EmailIngestLog" WHERE "organizationId"=${ORG} AND "createdAt" > '2026-07-28T12:00:00Z'
    ORDER BY "createdAt"`;
  logs.forEach(l => console.log(`${l.createdAt.toISOString().slice(5, 16)} [${l.status}] att=${l.attachmentCount} "${(l.subject || "").slice(0, 60)}"\n   ${l.reason || ""}`));
  // any new invoices created since 29 Jul?
  const newInvs: any[] = await prod.$queryRaw`
    SELECT name, type, status, config->>'xeroStatus' AS xs FROM "Document"
    WHERE "organizationId"=${ORG} AND type IN ('INVOICE','CREDIT_NOTE') AND "createdAt" > '2026-07-28T12:00:00Z' ORDER BY name`;
  console.log("\nnew invoices/CNs since 28 Jul noon:");
  newInvs.forEach(r => console.log(`  ${r.type} ${r.name} (${r.status})`));
  // the two bills' details
  for (const n of ["JP2607290103", "JP2607290104"]) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: n }, select: { config: true, createdAt: true } });
    const c: any = b?.config || {};
    console.log(`${n}: created=${b?.createdAt.toISOString().slice(0, 16)} ref="${c.reference || ""}" channel=${c.inboundChannel} supplier=${(c.supplier?.name || "").slice(0, 20)}`);
  }
  await prod.$disconnect();
})();
