import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BI202608014", "BI202608047"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name }, select: { config: true } });
    const c: any = d!.config;
    console.log(`\n═══ ${name}`);
    for (const it of c.items || []) if (Number(it.amount)) console.log(`  amt=${it.amount} code=${JSON.stringify(it.itemCode)} acct=${JSON.stringify(it.accountCode)} tax=${it.tax} :: ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 70)}`);
  }
  process.exit(0);
})();
