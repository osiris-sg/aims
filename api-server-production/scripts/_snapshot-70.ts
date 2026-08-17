import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import * as crypto from "crypto";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  const snap = ours.map(d => { const c: any = d.config; return { id: d.id, name: d.name, xeroInvoiceId: c.xeroInvoiceId, nett: c.nettTotal, itemsHash: crypto.createHash("md5").update(JSON.stringify(c.items)).digest("hex") }; });
  fs.writeFileSync(process.argv[2] || "scripts/_snap-70-before.json", JSON.stringify(snap, null, 1));
  console.log(`snapshotted ${snap.length} docs`);
  process.exit(0);
})();
