import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL" }, select: { id: true, name: true, status: true, config: true } });
  let n = 0;
  for (const d of docs) {
    const c: any = d.config;
    if (c.xeroSyncedBy !== "app2-jp-batch" && c.xeroSyncedBy !== "app2-ti2-push") continue;
    if ((c.billStatus || "").toUpperCase() === "POSTED") continue;
    await prisma.document.update({ where: { id: d.id }, data: { status: "confirmed" as any, config: { ...c, billStatus: "POSTED" } } });
    console.log(`✓ ${d.name}: billStatus ${c.billStatus || "—"} → POSTED`);
    n++;
  }
  console.log(`aligned ${n}`);
  process.exit(0);
})();
