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
    SELECT config->>'xeroStatus' AS xs, COUNT(*)::int AS n,
      ROUND(SUM(COALESCE((config->'totals'->>'total')::numeric,(config->>'nettTotal')::numeric,0)),2) AS total,
      STRING_AGG(DISTINCT COALESCE(config->'customer'->>'name', config->>'customerName'), ' | ') AS customers
    FROM "Document"
    WHERE "organizationId"=${ORG} AND type IN ('INVOICE','CREDIT_NOTE')
      AND config->>'xeroSyncedBy'='jpsg-push'
    GROUP BY 1 ORDER BY n DESC`;
  console.table(rows.map(r => ({ ...r, customers: (r.customers || "").slice(0, 60) })));
  const del: any[] = await prod.$queryRaw`
    SELECT name, COALESCE(config->'totals'->>'total', config->>'nettTotal') AS total, COALESCE(config->'customer'->>'name', config->>'customerName') AS cust
    FROM "Document" WHERE "organizationId"=${ORG} AND type IN ('INVOICE','CREDIT_NOTE')
      AND config->>'xeroSyncedBy'='jpsg-push' AND config->>'xeroStatus'='DELETED'
    ORDER BY name`;
  console.log(`deleted list (${del.length}):`);
  del.forEach(d => console.log(`  ${d.name} $${d.total} ${d.cust}`));
  await prod.$disconnect();
})();
