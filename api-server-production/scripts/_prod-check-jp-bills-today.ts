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
    SELECT name, type, status, "createdAt",
      config->>'reference' AS ref,
      config->'documentInfo'->>'reference' AS di_ref,
      config->>'xeroBillId' IS NOT NULL AS pushed,
      config->'items'->0->>'accountCode' AS acct,
      config->'totals'->>'total' AS total
    FROM "Document" WHERE "organizationId"=${ORG} AND (name LIKE 'JP26071401%' OR "createdAt" > NOW() - INTERVAL '20 hours')
    ORDER BY "createdAt" DESC LIMIT 15`;
  console.table(rows);
  // recent email ingest logs
  const logs: any[] = await prod.$queryRaw`
    SELECT "createdAt", subject, status, LEFT(COALESCE(error,''),120) AS error
    FROM "EmailIngestLog" WHERE "organizationId"=${ORG}
    ORDER BY "createdAt" DESC LIMIT 8`.catch(() => []);
  console.table(logs);
  await prod.$disconnect();
})();
