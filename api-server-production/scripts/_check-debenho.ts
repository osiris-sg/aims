import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "Debenho" } } });
  console.log("Customer row:", JSON.stringify({ name: cust?.name, address: (cust as any)?.address, email: (cust as any)?.email, phone: (cust as any)?.phone, xeroId: (cust as any)?.xeroId?.slice(0, 8) }, null, 1));
  // one of its drafts
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202608027" }, select: { config: true } });
  const c: any = d!.config;
  console.log("draft billTo:", JSON.stringify(c.billTo)?.slice(0, 200));
  console.log("draft customerAddress:", JSON.stringify(c.customerAddress)?.slice(0, 200));
  process.exit(0);
})();
