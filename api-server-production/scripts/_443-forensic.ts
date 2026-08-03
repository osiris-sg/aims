import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const lines: any[] = await prod.$queryRaw`
    SELECT j.reference AS ref, j.description AS des, l."debit" AS dr, l."credit" AS cr
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND (l."debit" > 0 OR l."credit" > 0)`;
  const credits = new Map<string, number>(), debits = new Map<string, number>();
  for (const l of lines) {
    const key = ((l.ref || l.des || "?").match(/(BIPL-JPSG-INV-[\d-]+|JPINV-[0-9A-F-]+|BI\d{9}|JP26\d{8})/i)?.[1] || (l.ref || l.des || "?").slice(0, 30));
    if (Number(l.cr) > 0) credits.set(key, (credits.get(key) || 0) + Number(l.cr));
    if (Number(l.dr) > 0) debits.set(key, (debits.get(key) || 0) + Number(l.dr));
  }
  console.log("=== CREDITS into 443 (recharge invoices):");
  let crT = 0;
  for (const [k, v] of [...credits.entries()].sort((a, b) => b[1] - a[1])) { console.log(`  CR $${v.toFixed(2).padStart(9)}  ${k}`); crT += v; }
  console.log(`  CR TOTAL $${crT.toFixed(2)}`);
  // debits: bills — sum by their AIMS ref target for matching
  console.log("\n=== DEBITS into 443 (bill costs), grouped by the invoice their AIMS ref points to:");
  const drByInv = new Map<string, number>();
  let drT = 0, unrefd = 0;
  for (const [k, v] of debits) {
    drT += v;
    if (/^JP26/.test(k)) {
      const b = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: k }, select: { config: true } });
      const r = (b?.config as any)?.reference || "(no ref)";
      const key = /^(BIPL|JPINV|BI\d)/.test(r) ? r : "(unrecharged/internal)";
      drByInv.set(key, (drByInv.get(key) || 0) + v);
    } else drByInv.set(k, (drByInv.get(key => k) as any || 0) + v);
  }
  for (const [k, v] of [...drByInv.entries()].sort((a, b) => b[1] - a[1])) console.log(`  DR $${v.toFixed(2).padStart(9)}  ${k}`);
  console.log(`  DR TOTAL $${drT.toFixed(2)}`);
  console.log("\n=== NET per invoice (CR − matching DR):");
  const all = new Set([...credits.keys(), ...drByInv.keys()]);
  for (const k of [...all].sort()) {
    const net = (credits.get(k) || 0) - (drByInv.get(k) || 0);
    if (Math.abs(net) > 0.005) console.log(`  ${net > 0 ? "+" : ""}${net.toFixed(2).padStart(9)}  ${k}`);
  }
  await prod.$disconnect();
})();
