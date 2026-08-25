// Split "Rental of Cables as follows:" headers that carry the first cable
// inline: header becomes its own blank line; the cable keeps the qty (guru
// 2026-08-25 — improves on July's combined-line keying).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0, splits = 0;
  for (const d of ours) {
    const c: any = d.config;
    const out: any[] = [];
    let dirty = false;
    let idb = 1798000000000 + changed * 100;
    for (const it of c.items || []) {
      const desc = it.description || "";
      const m = /^(\d?\)?\.?\s*Rental of Cables as follows:)\s*\n\s*\n(\s*\d[a-z]?\)\.?[\s\S]+)$/i.exec(desc);
      if (m && !Number(it.amount)) {
        dirty = true; splits++;
        out.push({ ...it, id: idb++, description: m[1].trim(), quantity: null, unitPrice: null, amount: null, tax: null, taxAmount: null, itemCode: "", accountCode: null });
        out.push({ ...it, id: idb++, description: m[2].trim() });
      } else out.push(it);
    }
    if (dirty) { changed++; if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items: out } } }); }
  }
  console.log(`${DRY ? "[DRY] would split" : "split"} ${splits} cable-header lines across ${changed} drafts`);
  process.exit(0);
})();
