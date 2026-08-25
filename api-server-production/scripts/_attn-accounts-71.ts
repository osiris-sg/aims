// Every company's Bill-to block ends with "Attn: Accounts Dept." (guru
// 2026-08-25). Skip blocks that already carry an Attn line (e.g. Debenho).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0;
  for (const d of ours) {
    const c: any = d.config;
    if (!c.billTo || /attn\s*:/i.test(c.billTo)) continue;
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, billTo: c.billTo.trimEnd() + "\nAttn: Accounts Dept." } } });
    changed++;
  }
  console.log(`added "Attn: Accounts Dept." to ${changed}/${ours.length} drafts' Bill-to`);
  process.exit(0);
})();
