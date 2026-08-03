import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const n of ["JP2606030067", "JP2606230079"]) {
    const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: n }, select: { config: true } });
    if (!b) { console.log(`${n}: NOT IN AIMS`); continue; }
    const c: any = b.config || {};
    console.log(`${n}: $${c.totalAmount} paid=${c.amountPaid ?? 0} ref="${c.reference || "(none)"}" xero=${c.xeroStatus || "-"}`);
  }
  await prod.$disconnect();
})();
