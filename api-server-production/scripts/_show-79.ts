import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1", name: "BI202608079", type: "INVOICE" }, select: { config: true } });
  for (const it of ((d!.config as any).items || [])) console.log(` qty=${JSON.stringify(it.quantity)} up=${JSON.stringify(it.unitPrice)} amt=${JSON.stringify(it.amount)} :: ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 70)}`);
  process.exit(0);
})();
