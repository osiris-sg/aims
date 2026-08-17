import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const jes = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, status: "POSTED", OR: [{ postedBy: null }, { NOT: { postedBy: "xero-import" } }] },
    select: { id: true, journalNumber: true, postedBy: true, entryDate: true, description: true, reference: true, totalDebit: true, sourceDocumentId: true, lines: { select: { debit: true, credit: true, account: { select: { code: true, name: true } } } } },
    orderBy: { entryDate: "asc" },
  } as any);
  console.log(`${jes.length} POSTED journals that are NOT xero-import (incl. null postedBy):`);
  const byCode: Record<string, number> = {};
  for (const j of jes as any[]) {
    console.log(`\n${j.journalNumber} ${j.entryDate?.toISOString().slice(0,10)} $${j.totalDebit} postedBy=${j.postedBy ?? "NULL"} src=${j.sourceDocumentId ? "doc" : "-"} · ${(j.description || j.reference || "").slice(0, 70)}`);
    for (const l of j.lines) {
      if (l.account?.code) byCode[l.account.code] = (byCode[l.account.code] || 0) + Number(l.debit) - Number(l.credit);
      console.log(`   ${l.account?.code} ${l.account?.name?.slice(0,28)}  DR ${l.debit}  CR ${l.credit}`);
    }
  }
  console.log("\nnet by account:", JSON.stringify(Object.fromEntries(Object.entries(byCode).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
  process.exit(0);
})();
