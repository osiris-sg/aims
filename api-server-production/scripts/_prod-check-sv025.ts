import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows: any[] = await prod.$queryRaw`SELECT * FROM "RevenueItem" WHERE "organizationId"=${ORG} AND (code='SV025' OR name ILIKE '%pass%')`;
  console.log(JSON.stringify(rows, null, 1).slice(0, 800));
  await prod.$disconnect();
})();
