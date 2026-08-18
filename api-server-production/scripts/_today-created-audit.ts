import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const start = new Date("2026-08-17T00:00:00+08:00");
  const logs = await prisma.auditLog.findMany({
    where: { organizationId: ORG, resource: "document", action: { contains: "create" }, createdAt: { gte: start } },
    orderBy: { createdAt: "asc" },
  } as any).catch(async () => {
    return prisma.auditLog.findMany({ where: { organizationId: ORG, createdAt: { gte: start } }, orderBy: { createdAt: "asc" }, take: 50 } as any);
  });
  console.log(`${(logs as any[]).length} audit events today:`);
  for (const l of logs as any[]) console.log(` `, l.createdAt.toISOString().slice(0, 16), l.action, "·", JSON.stringify(l.metadata || l.details || {}).slice(0, 120), "·", l.actorName || l.userId || "");
  process.exit(0);
})();
