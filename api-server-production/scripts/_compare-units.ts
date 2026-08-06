import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const zz = await prod.inventory.findMany({ where: { organizationId: ORG, sku: { in: ["ZZTEST-AST-004", "ZZTEST-AST-005"] } } });
  const slm = await prod.inventory.findFirst({ where: { organizationId: ORG, sku: { contains: "SLM1", mode: "insensitive" } } });
  const show = (i: any) => { const { id, assetId, organizationId, createdAt, updatedAt, ...rest } = i; return rest; };
  console.log("SLM1-like unit:", slm ? JSON.stringify(show(slm)) : "not found");
  zz.forEach(i => console.log(i.sku + ":", JSON.stringify(show(i))));
  await prod.$disconnect();
})();
