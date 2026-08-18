import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // candidates: recent client numbers + suffixed dupes; check which rows exist and look fresh
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: "INVOICE", OR: [
      { name: { in: ["BI202608059", "BI202608061", "BI202608092", "BI202608093", "BI202608094", "BI202608095", "BI202608096"] } },
      { name: { contains: "(" } },
    ], updatedAt: { gte: new Date("2026-08-16T16:00:00Z") } },
    orderBy: { name: "asc" },
    select: { name: true, status: true, createdAt: true, updatedAt: true, config: true },
  });
  for (const d of docs) {
    const c: any = d.config;
    console.log(`${d.name} [${d.status}] docDate=${(c.date || "").slice(0,10)} · ${(c.customer?.name || c.customerName || "?").slice(0,35)} · $${c.nettTotal ?? c.xeroGross} · xero=${c.xeroStatus}`);
  }
  process.exit(0);
})();
