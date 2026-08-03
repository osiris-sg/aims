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
    where: { organizationId: ORG, name: { contains: "20260524-0001" } },
    select: { name: true, type: true, status: true, createdAt: true, config: true },
  });
  for (const r of rows) {
    const c: any = r.config || {};
    console.log(`${r.type} "${r.name}" ${r.status} created=${r.createdAt.toISOString().slice(0, 10)} xero=${c.xeroStatus || "-"} total=$${c.totals?.total ?? c.nettTotal} cust=${(c.customerName || c.customer?.name || "").slice(0, 30)}`);
    (c.items || []).forEach((it: any) => console.log(`   item qty=${it.quantity} unit=${it.unitPrice} amt=${it.amount} "${(it.description || "").split("\n")[0].slice(0, 60)}"`));
  }
  await prod.$disconnect();
})();
