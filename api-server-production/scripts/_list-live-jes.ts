import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const live = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, status: "POSTED", NOT: { postedBy: "xero-import" } },
    select: { journalNumber: true, description: true, reference: true, totalDebit: true, postedBy: true, entryDate: true, sourceDocumentId: true, lines: { select: { debit: true, credit: true, account: { select: { code: true, name: true } } } } },
  } as any);
  console.log(`${live.length} live POSTED journals (not xero-import):`);
  for (const j of live as any[]) {
    console.log(`\n${j.journalNumber} ${j.entryDate?.toISOString().slice(0,10)} $${j.totalDebit} · ${(j.description || j.reference || "").slice(0, 80)} · by ${j.postedBy || "?"}`);
    for (const l of j.lines) console.log(`   ${l.account?.code} ${l.account?.name?.slice(0,30)}  DR ${l.debit}  CR ${l.credit}`);
  }
  process.exit(0);
})();
