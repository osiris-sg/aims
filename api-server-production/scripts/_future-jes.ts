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
    where: { organizationId: ORG, status: "POSTED", entryDate: { gt: new Date() } },
    select: { journalNumber: true, entryDate: true, description: true, postedBy: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  } as any);
  console.log(`${jes.length} POSTED journals dated AFTER today:`);
  const byCode: Record<string, number> = {};
  for (const j of jes as any[]) {
    console.log(`  ${j.journalNumber} ${j.entryDate?.toISOString().slice(0,10)} · ${(j.description || "").slice(0, 60)} · ${j.postedBy}`);
    for (const l of j.lines) if (l.account?.code) byCode[l.account.code] = (byCode[l.account.code] || 0) + Number(l.debit) - Number(l.credit);
  }
  console.log("net by account:", JSON.stringify(Object.fromEntries(Object.entries(byCode).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
  process.exit(0);
})();
