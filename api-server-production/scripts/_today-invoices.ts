import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // "today" in SGT: from local midnight
  const start = new Date("2026-08-18T00:00:00+08:00");
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: start } },
    orderBy: { createdAt: "asc" },
    select: { name: true, status: true, createdAt: true, config: true },
  });
  console.log(`${docs.length} invoices created in AIMS today (since 18 Aug 00:00 SGT):`);
  for (const d of docs) {
    const c: any = d.config;
    const src = c.xeroImported ? "xero-sync" : c.xeroSyncedBy ? c.xeroSyncedBy : c.ingestSource ? "ingestion" : "AIMS-born";
    console.log(`  ${d.createdAt.toISOString().replace("T", " ").slice(0, 16)}Z · ${d.name} [${d.status}] · ${(c.customerName || c.customer?.name || "?").slice(0, 35)} · $${c.nettTotal ?? c.total ?? "?"} · ${src} · xeroStatus=${c.xeroStatus || "—"}`);
  }
  process.exit(0);
})();
