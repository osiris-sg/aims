import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL" }, select: { id: true, name: true, config: true } });
  let fixed = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    if (c.billStatus === "DRAFT" && ["AUTHORISED", "PAID"].includes(c.xeroStatus)) {
      await prod.document.update({ where: { id: b.id }, data: { status: "confirmed", config: { ...c, billStatus: c.xeroStatus === "PAID" ? "PAID" : "POSTED" } } });
      fixed++;
    }
  }
  console.log(`aligned ${fixed} bills' native status to Xero truth`);
  await prod.$disconnect();
})();
