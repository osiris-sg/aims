import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["TI2202607-004", "TI2202607-006"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "BILL", name }, select: { config: true } });
    const c: any = d!.config;
    console.log(`\n═══ ${name} · totalAmount=${c.totalAmount} taxAmount=${c.taxAmount} subtotal=${c.subtotal} amountsAre=${c.amountsAre} currency=${c.currency} inboundChannel=${c.inboundChannel}`);
    console.log("  config.lines:", JSON.stringify(c.lines)?.slice(0, 300));
    if (c.journalEntryId) {
      const je = await prisma.journalEntry.findUnique({ where: { id: c.journalEntryId }, select: { journalNumber: true, status: true, postedBy: true, lines: { select: { debit: true, credit: true, account: { select: { code: true, name: true } } } } } } as any);
      console.log(`  JE ${(je as any)?.journalNumber} [${(je as any)?.status}] postedBy=${(je as any)?.postedBy}`);
      for (const l of (je as any)?.lines || []) console.log(`    ${l.account?.code} ${l.account?.name?.slice(0, 30)} DR ${l.debit} CR ${l.credit}`);
    }
  }
  process.exit(0);
})();
