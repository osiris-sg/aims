import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  // find Xero-imported GB/UT bills with taxAmount > 0 and inspect their items' taxType
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL", OR: [{ name: { startsWith: "UT26" } }, { name: { startsWith: "GB26" } }] }, select: { name: true, config: true }, take: 400 });
  const seen: Record<string, number> = {};
  for (const b of bills) {
    const c: any = b.config;
    if (!c.xeroImported) continue;
    for (const it of c.items || []) if (it.taxType) seen[it.taxType] = (seen[it.taxType] || 0) + 1;
  }
  console.log("taxTypes on imported GB/UT bills:", JSON.stringify(seen));
  process.exit(0);
})();
