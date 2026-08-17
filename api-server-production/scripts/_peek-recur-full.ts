import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BI2026080118", "BI2026080117"]) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, name }, select: { config: true } });
    const c: any = d!.config;
    console.log(`\n=== ${name}: keys:`, Object.keys(c).join(","));
    for (const k of ["date","dueDate","reference","notes","currency","customerId","subTotal","gstAmount","nettTotal","documentInfo"]) console.log("  ", k, "=", JSON.stringify(c[k])?.slice(0, 100));
    console.log("  items:", JSON.stringify(c.items)?.slice(0, 400));
    if (c.customerId) {
      const cust = await prod.customer.findUnique({ where: { id: c.customerId } });
      console.log("  customer row:", cust?.name, "| xeroContactId:", (cust as any)?.xeroId, "| currency:", (cust as any)?.currency);
    }
  }
  // how many of the 71 have customerId + how many customers lack xeroContactId
  const docs = await prod.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") }, name: { startsWith: "BI20260801" } }, select: { name: true, config: true } });
  const ids = new Set<string>();
  let noCust = 0;
  for (const d of docs) { const cid = (d.config as any)?.customerId; if (cid) ids.add(cid); else noCust++; }
  const custs = await prod.customer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, xeroId: true } });
  console.log(`\n${docs.length} docs; ${noCust} without customerId; ${ids.size} distinct customers; ${custs.filter((c: any) => !(c as any).xeroId).length} customers missing xeroContactId`);
  process.exit(0);
})();
