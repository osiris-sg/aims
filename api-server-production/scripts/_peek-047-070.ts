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
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name }, select: { config: true } });
    const c: any = d!.config;
    console.log(`\n═══ ${name} (${c.customerName || "?"})`);
    for (const it of c.items || []) console.log(`  amt=${it.amount} code=${JSON.stringify(it.itemCode)} acct=${it.accountCode} :: ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 100)}`);
  }
  process.exit(0);
})();
