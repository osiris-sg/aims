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
    select: { id: true, journalNumber: true, description: true, sourceDocumentId: true, reversesEntryId: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  } as any);
  const rows = live as any[];
  // net by account
  const net: Record<string, number> = {};
  for (const j of rows) for (const l of j.lines) { const c = l.account?.code; if (c) net[c] = (net[c] || 0) + Number(l.debit) - Number(l.credit); }
  console.log(`${rows.length} local journals, NET by account:`);
  for (const [c, v] of Object.entries(net)) if (Math.abs(v) > 0.005) console.log(`  ${c}: ${(Math.round(v * 100) / 100).toLocaleString()}`);
  // group by source doc
  const byDoc = new Map<string, any[]>();
  for (const j of rows) {
    const key = j.sourceDocumentId || (j.description?.match(/JV-\d+/) ? "reversal-chain" : j.description?.slice(0, 40) || "?");
    byDoc.set(String(key), [...(byDoc.get(String(key)) || []), j]);
  }
  console.log(`\nby source doc:`);
  for (const [k, js] of byDoc) {
    let docName = k;
    if (k.length === 36) { const d = await prisma.document.findUnique({ where: { id: k }, select: { name: true, config: true } }).catch(() => null); if (d) docName = `${d.name} [xero:${(d.config as any)?.xeroStatus || "not-linked"}]`; }
    console.log(`  ${docName}: ${js.length} JEs (${js.map((j: any) => j.journalNumber).join(",")})`);
  }
  process.exit(0);
})();
