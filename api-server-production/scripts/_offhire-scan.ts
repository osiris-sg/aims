import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const OFF = /off[\s-]?hire/i;
(async () => {
  const invs = await prod.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "CREDIT_NOTE"] } }, select: { name: true, type: true, config: true } });
  let n = 0;
  for (const inv of invs) {
    const c: any = inv.config || {};
    const dateStr = c.date || c.documentInfo?.date || "";
    const d = new Date(dateStr);
    if (!(d >= new Date("2000-01-01") && d < new Date("2026-09-01"))) continue;
    const blob = [c.xeroReference, ...(c.items || []).map((it: any) => it.description)].filter(Boolean).join("\n");
    if (!OFF.test(blob)) continue;
    n++;
    const cust = c.customer?.name || c.customerName || c.documentInfo?.customerName || "?";
    console.log(`\n${inv.name} [${inv.type}] ${dateStr.slice(0,10)} · ${cust} · $${(c.total ?? c.documentInfo?.total ?? 0).toLocaleString()} · ${c.xeroStatus || "?"}`);
    for (const line of blob.split("\n")) if (OFF.test(line)) console.log("   >>", line.trim().slice(0, 160));
  }
  console.log(`\n${n} doc(s) mention off-hire (Jun–Aug 2026)`);
  process.exit(0);
})();
