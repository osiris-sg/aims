import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BI2026080181", "BI2026080187"]) {
    const d = await prod.document.findFirst({ where: { organizationId: ORG, name }, select: { config: true } });
    const c: any = d!.config;
    console.log(`\n${name}: sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal}`);
    for (const it of c.items || []) console.log("  ", JSON.stringify({ tax: it.tax, taxAmount: it.taxAmount, amt: it.amount, acct: it.accountCode, desc: (it.description || "").slice(0, 60) }));
  }
  process.exit(0);
})();
