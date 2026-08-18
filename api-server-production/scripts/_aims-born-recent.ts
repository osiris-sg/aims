import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, createdAt: { gte: new Date("2026-08-15T00:00:00+08:00") } },
    orderBy: { createdAt: "asc" },
    select: { name: true, type: true, status: true, createdAt: true, updatedAt: true, config: true },
  });
  const born = docs.filter(d => { const c: any = d.config; return !c?.xeroImported && c?.xeroSyncedBy !== "app2-recurring-push"; });
  console.log(`${born.length} AIMS-born docs created since 15 Aug (of ${docs.length} total rows in window):`);
  for (const d of born) {
    const c: any = d.config;
    console.log(`  ${d.createdAt.toISOString().replace("T", " ").slice(0, 16)} · ${d.name} [${d.type}/${d.status}] · ${(c.customerName || c.customer?.name || "?").slice(0, 32)} · $${c.nettTotal ?? c.grossTotal ?? c.total ?? "?"} · lastUsedBy=${c.lastUsedBy || c.createdBy || "?"}`);
  }
  // wide audit sweep
  const logs = await prisma.auditLog.findMany({ where: { organizationId: ORG, createdAt: { gte: new Date("2026-08-15T00:00:00+08:00") } }, orderBy: { createdAt: "asc" }, take: 60, select: { createdAt: true, action: true, resource: true, resourceName: true, userName: true, userEmail: true } });
  console.log(`\n${logs.length} audit events since 15 Aug:`);
  for (const l of logs) console.log(`  ${l.createdAt.toISOString().replace("T", " ").slice(0, 16)} · ${l.action} ${l.resource} ${l.resourceName || ""} · ${l.userName || l.userEmail || ""}`);
  process.exit(0);
})();
