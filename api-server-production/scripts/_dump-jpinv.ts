import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const rows = await prod.document.findMany({
    where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "JPINV-" } },
    select: { name: true, status: true, config: true },
  });
  for (const r of rows) {
    const c: any = r.config || {};
    console.log(`\n${r.name} (${r.status}) customer=${c.customerName || c.customer?.name}`);
    console.log(`  di=${JSON.stringify(c.documentInfo || {}).slice(0, 200)}`);
    (c.items || []).forEach((it: any) => console.log(`  item: qty=${it.quantity} unit=${it.unitPrice} amt=${it.amount} acct=${it.accountCode || "-"} "${(it.description || "").slice(0, 100).replace(/\n/g, " | ")}"`));
  }
  await prod.$disconnect();
})();
