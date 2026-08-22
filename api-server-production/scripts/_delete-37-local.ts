// Delete ALL local (non xero-import) POSTED journals: their docs are now
// AUTHORISED in Xero (journals import on next GL sync) or they're orphaned
// reversals. Xero's journal is the book entry (follow-Xero model).
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
    select: { id: true, journalNumber: true, totalDebit: true, description: true },
  });
  console.log(`deleting ${live.length} local journals...`);
  let sum = 0;
  for (const j of live) { await prisma.journalEntry.delete({ where: { id: j.id } }); sum += Number(j.totalDebit); }
  console.log(`✓ deleted ${live.length} ($${sum.toFixed(2)} total debits)`);
  process.exit(0);
})();
