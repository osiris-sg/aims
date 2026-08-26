import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const types = await prisma.chartOfAccount.groupBy({ by: ["accountType"], where: { organizationId: ORG }, _count: true } as any);
  console.log(JSON.stringify(types, null, 1));
  const bankish = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG, OR: [{ name: { contains: "DBS", mode: "insensitive" } }, { name: { contains: "bank", mode: "insensitive" } }, { name: { contains: "Airwallex", mode: "insensitive" } }, { name: { contains: "Cash", mode: "insensitive" } }, { code: { in: ["090", "100", "103", "106", "106-2"] } }] }, select: { code: true, name: true, accountType: true } });
  for (const b of bankish) console.log(`  ${(b.code || "—").padEnd(6)} [${b.accountType}] ${b.name}`);
  process.exit(0);
})();
