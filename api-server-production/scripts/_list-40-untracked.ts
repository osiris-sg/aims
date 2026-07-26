import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const bills = await prod.document.findMany({
    where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } },
    select: { id: true, name: true, config: true },
    orderBy: { name: "asc" },
  });
  const out: string[] = [];
  for (const b of bills) {
    const pay = await prod.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id }, select: { id: true } });
    const c: any = b.config || {};
    if (!pay && c.billStatus !== "PAID") out.push(`${b.name}\t$${c.totalAmount ?? "?"}\tref=${(c.reference || "").slice(0, 40)}`);
  }
  console.log(`unpaid JP bills not in tracker: ${out.length}`);
  out.forEach(l => console.log(l));
  await prod.$disconnect();
})();
