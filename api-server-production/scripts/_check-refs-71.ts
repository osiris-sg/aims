import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" }, select: { name: true, config: true } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let filled = 0; const blank: string[] = [];
  for (const d of ours) {
    const c: any = d.config;
    const ref = (c.reference || c.referenceNo || "").trim();
    if (ref) { filled++; }
    else blank.push(`${d.name} · ${(c.customerName || c.customer?.name || "?").slice(0, 30)}`);
  }
  console.log(`${filled}/${ours.length} have a reference; ${blank.length} blank:`);
  for (const b of blank) console.log("  ✗", b);
  // sample of filled ones
  console.log("\nsamples:");
  for (const d of ours.slice(0, 5)) console.log(`  ${d.name}: "${((d.config as any).reference || "").slice(0, 80)}"`);
  process.exit(0);
})();
