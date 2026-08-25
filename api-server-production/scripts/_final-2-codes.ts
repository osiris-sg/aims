import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const FIX: Record<string, string> = { BI202608047: "AF60", BI202608070: "DBBOX" }; // unit named in the doc's header line
(async () => {
  for (const [name, code] of Object.entries(FIX)) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name } });
    const c: any = d!.config;
    const items = (c.items || []).map((it: any) => (Number(it.amount) && !it.itemCode ? { ...it, itemCode: code } : it));
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items } } });
    console.log(`✓ ${name} → ${code}`);
  }
  process.exit(0);
})();
