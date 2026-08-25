import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const snap = JSON.parse(fs.readFileSync("scripts/_snap-70-before5.json", "utf8"));
  for (const s of snap) {
    const d = await prisma.document.findUnique({ where: { id: s.id }, select: { name: true, status: true, config: true } });
    if (!d) { console.log(`✗ ${s.name}: ROW DELETED`); continue; }
    const c: any = d.config;
    if (c.xeroSyncedBy !== "app2-recurring-push") console.log(`⚠ ${s.name} → now ${d.name} [${d.status}]: syncedBy=${c.xeroSyncedBy || "lost"} xeroStatus=${c.xeroStatus}`);
  }
  console.log("done");
  process.exit(0);
})();
