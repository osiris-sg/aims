import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // model the row on 106 Petty Cash - Dennis so type/flags match exactly
  const dennis = await prod.chartOfAccount.findFirst({ where: { organizationId: ORG, code: "106" } });
  if (!dennis) throw new Error("106 not found");
  const existing = await prod.chartOfAccount.findFirst({ where: { organizationId: ORG, name: "Petty Cash - Eve" } });
  if (existing) { console.log(`already exists: ${existing.code} ${existing.name}`); return; }
  const { id, code, name, createdAt, updatedAt, ...rest } = dennis as any;
  const eve = await prod.chartOfAccount.create({
    data: { ...rest, code: "106-2", name: "Petty Cash - Eve" },
  });
  console.log(`created: ${eve.code} ${eve.name} (type=${eve.accountType}, modeled on 106)`);
  await prod.$disconnect();
})();
