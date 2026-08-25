import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 45);
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1", name: "BI202608079", type: "INVOICE" }, select: { config: true } });
  for (const it of ((d!.config as any).items || [])) console.log(JSON.stringify(norm(it.description)));
  // july gen line norm (from earlier peek): 
  console.log("JULY GEN:", JSON.stringify(norm("2). Rental of one unit 60KVA Denyo Soundproof Diesel Generator\nwith AMF Relay c/w Oil Tray & Key.")));
  process.exit(0);
})();
