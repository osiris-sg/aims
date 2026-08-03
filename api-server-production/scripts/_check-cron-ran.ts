import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const [je]: any[] = await prod.$queryRaw`
    SELECT MAX("createdAt") AS last_created, COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '18 hours')::int AS added_18h
    FROM "JournalEntry" WHERE "organizationId"=${ORG}`;
  console.log(`GL: last journal inserted ${je.last_created?.toISOString()} · added in last 18h: ${je.added_18h}`);
  const [docs]: any[] = await prod.$queryRaw`
    SELECT COUNT(*)::int AS updated_18h, MAX("updatedAt") AS last
    FROM "Document" WHERE "organizationId"=${ORG} AND "updatedAt" > NOW() - INTERVAL '18 hours'`;
  console.log(`docs updated in last 18h: ${docs.updated_18h} · last at ${docs.last?.toISOString()}`);
  const runs: any[] = await prod.$queryRaw`
    SELECT * FROM "XeroSyncRun" WHERE "organizationId"=${ORG} ORDER BY "createdAt" DESC LIMIT 3`.catch(() => []);
  console.log("XeroSyncRun rows:", runs.length ? JSON.stringify(runs).slice(0, 400) : "none");
  await prod.$disconnect();
})();
