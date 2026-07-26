import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // docs created by this import run (born in Xero since 23 Jul)
  const fresh: any[] = await prod.$queryRaw`
    SELECT type, name, status, config->>'xeroStatus' AS xstatus, COALESCE(config->'totals'->>'total', config->>'xeroGross', config->>'totalAmount') AS total
    FROM "Document" WHERE "organizationId"=${ORG} AND "createdAt" > NOW() - INTERVAL '15 minutes'
    ORDER BY type, name`;
  console.log("NEW docs (accountant-created in Xero):");
  console.table(fresh);
  // guard-protected docs where Xero-side totals now differ from AIMS content (she edited lines on our pushed docs)
  const drift: any[] = await prod.$queryRaw`
    SELECT name, type, config->>'totalAmount' AS aims_total, config->>'xeroGross' AS xero_total, config->>'xeroStatus' AS xstatus
    FROM "Document" WHERE "organizationId"=${ORG} AND type='BILL' AND name LIKE 'JP26%'
      AND config->>'xeroGross' IS NOT NULL
      AND ABS(COALESCE((config->>'totalAmount')::numeric,0) - COALESCE((config->>'xeroGross')::numeric,0)) > 0.01
    LIMIT 20`;
  console.log("JP bills where Xero total now differs from AIMS content:");
  console.table(drift);
  // voided recently
  const voided: any[] = await prod.$queryRaw`
    SELECT name, type, config->>'xeroStatus' AS xstatus FROM "Document"
    WHERE "organizationId"=${ORG} AND config->>'xeroStatus' IN ('VOIDED','DELETED')
      AND "updatedAt" > NOW() - INTERVAL '15 minutes' AND type IN ('BILL','INVOICE','CREDIT_NOTE') LIMIT 15`;
  console.log("newly voided/deleted:");
  console.table(voided);
  await prod.$disconnect();
})();
