// All 71 drafts: due date 31/08/2026; TERMS shows the matching day count
// (due − invoice date) so the printed terms and due date agree.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DUE = new Date("2026-08-31T00:00:00+08:00");
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0;
  for (const d of ours) {
    const c: any = d.config;
    const invDate = new Date((c.date || "2026-08-01").slice(0, 10) + "T00:00:00+08:00");
    const days = Math.max(0, Math.round((DUE.getTime() - invDate.getTime()) / 86400000));
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, dueDate: "2026-08-31", paymentTerms: `${days} DAYS`, documentInfo: { ...(c.documentInfo || {}), dueDate: "2026-08-31" } } } });
    changed++;
  }
  console.log(`set due 31/08/2026 (+matching TERMS) on ${changed}/${ours.length} drafts`);
  process.exit(0);
})();
