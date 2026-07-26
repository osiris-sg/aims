import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const MISSING = "JP2604100055 JP2604150119 JP2604160066 JP2604270072 JP2604270178 JP2604270179 JP2604270180 JP2604270181 JP2604270182 JP2604270184 JP2605160024 JP2605160026 JP2606010011".split(" ");
(async () => {
  for (const n of MISSING) {
    const d: any[] = await prod.$queryRaw`
      SELECT name, status, config->>'xeroStatus' AS xs, config->>'xeroGross' AS total, config->>'xeroBillId' IS NOT NULL AS linked
      FROM "Document" WHERE "organizationId"=${ORG} AND type='BILL' AND name LIKE ${n + "%"}`;
    console.log(n, "→", d.length ? d.map(r => `"${r.name}" ${r.xs} $${r.total}`).join(" | ") : "still missing");
  }
  await prod.$disconnect();
})();
