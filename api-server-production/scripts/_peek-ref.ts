import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BI202607009", "BI202607012", "BI202607031"]) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, name } });
    const c: any = d?.config || {};
    const di = c.documentInfo || {};
    console.log("\n=== " + name);
    for (const k of Object.keys(c)) if (/ref|po|order/i.test(k)) console.log("  c." + k, "=", JSON.stringify(c[k])?.slice(0, 150));
    for (const k of Object.keys(di)) if (/ref|po|order/i.test(k)) console.log("  di." + k, "=", JSON.stringify(di[k])?.slice(0, 150));
    console.log("  di keys:", Object.keys(di).join(","));
    const items: any[] = c.items || [];
    if (items[0]) console.log("  item0:", JSON.stringify(items[0]).slice(0, 300));
  }
  process.exit(0);
})();
