import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202608091 (" } } });
  if (!d) { console.log("suffixed row not found"); process.exit(1); }
  const c: any = d.config;
  console.log(`found ${d.name}: voided=${c.voided} balance=${c.xeroBalance} status=${c.xeroStatus} gross=${c.xeroGross}`);
  const { ...cfg } = c;
  await prisma.document.update({ where: { id: d.id }, data: { status: "pending_payment" as any, config: { ...cfg, voided: false, xeroBalance: 15983.76, paymentStatus: "pending_payment", paymentStatusSource: "phantom-repair-2026-08-17" } } });
  console.log("✓ un-voided, balance restored to 15,983.76");
  // 4 live journals
  const live = await prisma.journalEntry.findMany({ where: { organizationId: ORG, status: "POSTED", NOT: { postedBy: "xero-import" } }, select: { id: true, entryNumber: true, description: true, totalDebit: true, postedBy: true, entryDate: true } });
  console.log(`\n${live.length} live (non-xero-import) POSTED journals:`);
  for (const j of live) console.log(`  ${j.entryNumber} ${j.entryDate?.toISOString().slice(0,10)} $${j.totalDebit} · ${(j.description || "").slice(0, 70)} · by ${j.postedBy}`);
  process.exit(0);
})();
