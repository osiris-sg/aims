import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BI202608023", "BI202608009"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name, type: "INVOICE" }, select: { config: true } });
    const c: any = d!.config;
    console.log(`\n=== ${name}`);
    for (const it of c.items || []) console.log(" ", JSON.stringify({ code: it.itemCode, qty: it.quantity, amt: it.amount, acct: it.accountCode, desc: (it.description || "").replace(/\n/g, " ¶ ").slice(0, 70) }));
  }
  // template itemCodes for the 66 rebuilt: distinct codes
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { name: true, config: true, lastRunDocumentId: true } });
  const codes = new Set<string>();
  for (const t of tpls) for (const it of ((t.config as any)?.items || [])) if (it.itemCode) codes.add(it.itemCode);
  console.log("\ntemplate itemCode universe:", [...codes].join(", "));
  process.exit(0);
})();
