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
    SELECT type, name, status, "createdAt", config->'totals'->>'total' AS total, config->>'customerName' AS cust,
           config->'customer'->>'name' AS cust2
    FROM "Document" WHERE "organizationId"=${ORG} AND name LIKE 'BIPL-JPSG-INV-20260715%' ORDER BY name`;
  console.table(rows);
  await prod.$disconnect();
})();
