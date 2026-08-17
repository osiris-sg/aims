import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const MAP: Record<string, string> = {
  "BI202608WFM": "BI202608010",
  "BI202608WFC-1": "BI202608011",
  "BI202608WFC-2": "BI202608012",
  "BI202608WFC-3": "BI202608013",
};
(async () => {
  for (const [oldNo, newNo] of Object.entries(MAP)) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: oldNo } });
    if (!d) { console.log(`✗ ${oldNo} not found`); continue; }
    const c: any = d.config;
    await prisma.document.update({ where: { id: d.id }, data: { name: newNo, config: { ...c, documentNumber: newNo, pendingXeroRenumber: true } } });
    console.log(`✓ ${oldNo} → ${newNo} (Xero still has the letter code until push)`);
  }
  process.exit(0);
})();
