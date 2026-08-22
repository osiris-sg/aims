import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["GB2600000434CN", "GB2600000436CN"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "BILL", name } });
    const c: any = d!.config;
    // credit notes are not payable bills — exclude from the AP bill count
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, billStatus: "CREDIT" } } });
    console.log(`✓ ${name}: billStatus POSTED → CREDIT (excluded from AP outstanding)`);
  }
  process.exit(0);
})();
