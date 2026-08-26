import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
(async () => {
  const p = await prisma.bankStatementLine.findMany({ where: { organizationId: "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1", status: "PENDING", createdAt: { gte: new Date("2026-08-26") } } });
  for (const l of p) console.log(`${l.date.toISOString().slice(0, 10)} $${l.amount} · ${l.description} · ref=${l.reference}`);
  process.exit(0);
})();
