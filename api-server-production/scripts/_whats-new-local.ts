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
    where: { organizationId: ORG, status: "POSTED", OR: [{ postedBy: null }, { NOT: { postedBy: "xero-import" } }] },
    select: { journalNumber: true, createdAt: true, entryDate: true, description: true, totalDebit: true, sourceDocumentId: true, lines: { select: { debit: true, credit: true, account: { select: { code: true, name: true } } } } },
    orderBy: { createdAt: "asc" },
  } as any);
  console.log(`${(live as any[]).length} local POSTED journals:`);
  for (const j of live as any[]) {
    console.log(`\n${j.journalNumber} created=${j.createdAt.toISOString().slice(0, 16)} date=${j.entryDate?.toISOString().slice(0, 10)} $${j.totalDebit} · ${(j.description || "").slice(0, 70)}`);
    for (const l of j.lines) console.log(`   ${l.account?.code} ${l.account?.name?.slice(0, 30)} DR ${l.debit} CR ${l.credit}`);
    if (j.sourceDocumentId) {
      const doc = await prisma.document.findUnique({ where: { id: j.sourceDocumentId }, select: { name: true, type: true } }).catch(() => null);
      if (doc) console.log(`   source: ${doc.name} [${doc.type}]`);
    }
  }
  process.exit(0);
})();
