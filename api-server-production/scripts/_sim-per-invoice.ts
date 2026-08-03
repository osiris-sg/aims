import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  const crRows: any[] = await prod.$queryRaw`
    SELECT j.reference AS ref, COUNT(DISTINCT j.id)::int AS n, SUM(l."credit") AS cr
    FROM "JournalEntry" j JOIN "JournalEntryLine" l ON l."journalEntryId"=j.id
    JOIN "ChartOfAccount" c ON c.id=l."accountId"
    WHERE j."organizationId"=${ORG} AND c."code"='443' AND l."credit" > 0 GROUP BY 1`;
  const cred = new Map<string, number>();
  for (const r of crRows) {
    const k = (r.ref || "").match(/(BIPL-JPSG-INV-[\d-]+|JPINV-[0-9A-F-]+|BI\d{9})/i)?.[1];
    if (!k) { console.log(`unmatched CR ref: "${r.ref}" $${r.cr}`); continue; }
    // steady state: dedup to a single posting
    cred.set(k, (cred.get(k) || 0) + Number(r.cr) / r.n * 1 * (1) * (r.n > 1 ? 1 : 1) * (Number(r.cr) / Number(r.cr)) * (Number(r.cr) / r.n === Number(r.cr) / r.n ? 1 : 1) + (r.n > 1 ? 0 : 0));
    cred.set(k, (cred.get(k) || 0) - Number(r.cr) + Number(r.cr) / r.n); // keep one copy
  }
  const bills = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  const dr = new Map<string, number>();
  for (const b of bills) {
    const c: any = b.config || {};
    const r = c.reference || "";
    if (!/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(r)) continue;
    dr.set(r, (dr.get(r) || 0) + Number(c.totalAmount || 0));
  }
  // expected arrivals
  dr.set("BI202607106", (dr.get("BI202607106") || 0) + 20);
  dr.set("BIPL-JPSG-INV-20260721-0036", (dr.get("BIPL-JPSG-INV-20260721-0036") || 0) + 40);
  dr.set("BIPL-JPSG-INV-20260721-0038", (dr.get("BIPL-JPSG-INV-20260721-0038") || 0) + 20);
  // CN debits
  const cnDr = new Map<string, number>([["BIPL-JPSG-INV-20260505-0002", 14], ["BIPL-JPSG-INV-20260522-0001", 2], ["BIPL-JPSG-INV-20260526-0065", 11]]);
  const keys = new Set([...cred.keys(), ...dr.keys()]);
  let total = 0;
  console.log("steady-state per-invoice residual (CR − DR − CN):");
  for (const k of [...keys].sort()) {
    const res = (cred.get(k) || 0) - (dr.get(k) || 0) - (cnDr.get(k) || 0);
    total += res;
    if (Math.abs(res) > 0.005) console.log(`  ${res > 0 ? "+" : ""}${res.toFixed(2).padStart(8)}  ${k}  (CR ${(cred.get(k) || 0).toFixed(2)} / DR ${(dr.get(k) || 0).toFixed(2)})`);
  }
  console.log(`TOTAL residual: ${total.toFixed(2)} (negative = 443 debit-heavy)`);
  await prod.$disconnect();
})();
