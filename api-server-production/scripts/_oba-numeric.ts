import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202608oba" } });
  if (!d) { console.log("not found"); process.exit(1); }
  const c: any = d.config;
  await prisma.document.update({ where: { id: d.id }, data: { name: "BI202608091", config: { ...c, documentNumber: "BI202608091", pendingXeroRenumber: true } } });
  console.log("✓ BI202608oba → BI202608091");
  process.exit(0);
})();
