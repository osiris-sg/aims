import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows = await prod.document.findMany({
    where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202607107" } },
    select: { id: true, name: true, status: true, config: true },
  });
  for (const r of rows) {
    const c: any = r.config || {};
    console.log(`"${r.name}" status=${r.status} xeroStatus=${c.xeroStatus} xeroBalance=${c.xeroBalance} total=${c.totals?.total ?? c.nettTotal}`);
  }
  await prod.$disconnect();
})();
