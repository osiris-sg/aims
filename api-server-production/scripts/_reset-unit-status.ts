import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const upd = await prod.inventory.updateMany({
    where: { organizationId: ORG, sku: { in: ["ZZTEST-AST-004", "ZZTEST-AST-005"] } },
    data: { status: "instock" },
  });
  console.log(`updated ${upd.count} units → instock`);
  await prod.$disconnect();
})();
