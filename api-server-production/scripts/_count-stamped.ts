import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, select: { name: true, config: true } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  console.log(`stamped: ${ours.length}`);
  const names = new Set(ours.map(d => d.name));
  for (const n of ["BI202608009"]) if (!names.has(n)) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n }, select: { config: true, status: true } });
    const c: any = d?.config || {};
    console.log(`${n}: status=${d?.status} syncedBy=${c.xeroSyncedBy || "GONE"} xeroStatus=${c.xeroStatus} createdAt-filter-miss=${!d ? "not found" : "found but outside filter or stamp lost"}`);
  }
  process.exit(0);
})();
