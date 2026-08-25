// Text lines: unit price + amount also blank (null), not 0.00 (guru 2026-08-25).
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
  let changed = 0, lines = 0;
  for (const d of ours) {
    const c: any = d.config;
    let dirty = false;
    const items = (c.items || []).map((it: any) => {
      const amt = Number(it.amount) || 0, up = Number(it.unitPrice) || 0;
      if (amt === 0 && up === 0 && (it.amount != null || it.unitPrice != null || it.taxAmount != null || it.tax != null)) {
        dirty = true; lines++;
        return { ...it, quantity: null, unitPrice: null, amount: null, taxAmount: null, tax: null };
      }
      return it;
    });
    if (dirty) { changed++; await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items } } }); }
  }
  console.log(`blanked unit/amount on ${lines} text lines across ${changed}/${ours.length} drafts`);
  process.exit(0);
})();
