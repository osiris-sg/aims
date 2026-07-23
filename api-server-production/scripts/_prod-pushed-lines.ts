import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const docs = await prod.document.findMany({
    where: { organizationId: ORG, name: { startsWith: "BIPL-JPSG-INV" }, type: "INVOICE" },
    select: { name: true, config: true },
  });
  const pushed = docs.filter(d => (d.config as any)?.xeroSyncedBy === "jpsg-push" || (d.config as any)?.xeroInvoiceId);
  const descCount = new Map<string, { n: number; total: number }>();
  const big: any[] = [];
  for (const d of pushed) {
    const c: any = d.config;
    const total = Number(c.totals?.total ?? c.nettTotal ?? 0);
    for (const it of c.items || []) {
      const key = (it.description || "?").split("\n")[0].slice(0, 60);
      const cur = descCount.get(key) || { n: 0, total: 0 };
      cur.n++; cur.total += Number(it.amount) || 0;
      descCount.set(key, cur);
    }
    if (total > 1000) big.push({ name: d.name, total, items: (c.items || []).length });
  }
  console.log(`pushed invoices: ${pushed.length}`);
  console.log("\nline descriptions across all pushed invoices:");
  for (const [k, v] of [...descCount.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15))
    console.log(`  ${String(v.n).padStart(4)}× $${v.total.toFixed(2).padStart(12)}  ${k}`);
  console.log("\ninvoices over $1,000:");
  console.table(big);
  await prod.$disconnect();
})();
