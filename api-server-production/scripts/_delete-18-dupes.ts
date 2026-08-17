import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const nums = Array.from({ length: 18 }, (_, i) => `JV-${String(i + 1).padStart(6, "0")}`);
  const jes = await prisma.journalEntry.findMany({ where: { organizationId: ORG, journalNumber: { in: nums }, status: "POSTED", postedBy: null }, select: { id: true, journalNumber: true, totalDebit: true, description: true } });
  console.log(`matched ${jes.length} of 18 (POSTED + postedBy NULL only)`);
  if (jes.length !== 18) { console.log("count mismatch — listing:", jes.map(j => j.journalNumber).join(",")); }
  let sum = 0;
  for (const j of jes) { await prisma.journalEntry.delete({ where: { id: j.id } }); sum += Number(j.totalDebit); console.log(`✓ deleted ${j.journalNumber} $${j.totalDebit}`); }
  console.log(`deleted ${jes.length} journals, $${sum.toFixed(2)} total debits`);
  process.exit(0);
})();
