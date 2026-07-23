import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const custs = await prod.customer.findMany({
    where: { organizationId: ORG, name: { contains: "ntegrate" } },
    select: { id: true, name: true, xeroId: true },
  });
  console.log("customers:", custs.map(c => `${c.name} (xero=${c.xeroId ? "yes" : "no"})`));
  const ids = custs.map(c => c.id);
  const docs: any[] = await prod.$queryRaw`
    SELECT name, type, status, "createdAt"::date AS created,
      config->>'xeroInvoiceId' IS NOT NULL AS synced,
      config->>'xeroStatus' AS xstatus,
      COALESCE(config->'totals'->>'total', config->>'nettTotal') AS total
    FROM "Document" WHERE "organizationId"=${ORG}
      AND (config->>'customerId' = ANY(${ids}) OR config->'customer'->>'name' ILIKE '%ntegrate%' OR config->>'customerName' ILIKE '%ntegrate%')
    ORDER BY name`;
  console.table(docs);
  await prod.$disconnect();
})();
