import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  for (const d of ours) {
    const c: any = d.config;
    if (c.lineFormat) continue; // rebuilt from July source already
    const items: any[] = c.items || [];
    // blob heuristic: a description containing 2+ numbered sections
    const blobby = items.some(it => ((it.description || "").match(/\n\s*\d\)\.?\s/g) || []).length >= 2);
    console.log(`${d.name} · ${items.length} items · blobby=${blobby} · xeroStatus=${c.xeroStatus} · $${c.nettTotal}`);
  }
  process.exit(0);
})();
