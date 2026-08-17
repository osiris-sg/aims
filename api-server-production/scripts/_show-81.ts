import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1", name: "BI202608081", type: "INVOICE" }, select: { config: true } });
  const c: any = d!.config;
  console.log(`sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal} (from ${c.lineFormat})`);
  for (const it of c.items || []) console.log(" ", JSON.stringify({ code: it.itemCode, amt: it.amount, tax: it.tax, acct: it.accountCode, desc: (it.description || "").replace(/\n/g, " ¶ ").slice(0, 85) }));
  process.exit(0);
})();
