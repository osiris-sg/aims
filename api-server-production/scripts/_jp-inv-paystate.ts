import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows: any[] = await prod.$queryRaw`
    SELECT COALESCE(config->>'xeroStatus','(not in xero)') AS xstatus, COUNT(*)::int AS n,
      ROUND(SUM(COALESCE((config->'totals'->>'total')::numeric,(config->>'nettTotal')::numeric,0)),2) AS total
    FROM "Document"
    WHERE "organizationId"=${ORG} AND type='INVOICE'
      AND (name LIKE 'BIPL-JPSG-INV%' OR name LIKE 'JPINV-%')
    GROUP BY 1 ORDER BY n DESC`;
  console.table(rows);
  const open: any[] = await prod.$queryRaw`
    SELECT name, config->>'xeroStatus' AS xs, COALESCE(config->'totals'->>'total', config->>'nettTotal') AS total,
      COALESCE(config->'customer'->>'name', config->>'customerName') AS cust
    FROM "Document"
    WHERE "organizationId"=${ORG} AND type='INVOICE'
      AND (name LIKE 'BIPL-JPSG-INV%' OR name LIKE 'JPINV-%')
      AND COALESCE(config->>'xeroStatus','') NOT IN ('PAID','DELETED','VOIDED')
    ORDER BY name`;
  console.log(`not yet paid (${open.length}):`);
  open.forEach(r => console.log(`  ${r.name.padEnd(32)} ${String(r.xs).padEnd(12)} $${String(r.total).padStart(9)} ${r.cust}`));
  await prod.$disconnect();
})();
