import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BI202608047", "BI202608070"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name } });
    const c: any = d!.config;
    const items: any[] = c.items || [];
    const donor = items.find(it => Number(it.amount) > 0 && it.itemCode);
    let fixed = 0;
    for (const it of items) if (Number(it.amount) && !it.itemCode) { it.itemCode = donor?.itemCode || ""; fixed++; }
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items } } });
    console.log(`✓ ${name}: ${fixed} line(s) → ${donor?.itemCode} (same unit as the doc's main line)`);
  }
  process.exit(0);
})();
