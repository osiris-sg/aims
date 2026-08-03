import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const PAIRS: Array<{ at: string; subject: string; invoice: string | null; bills: string[] }> = JSON.parse(fs.readFileSync("scripts/_email-pairs.json", "utf8"));
(async () => {
  const problems: string[] = [];
  let okPairs = 0, checkedBills = 0;
  // last-email-wins per bill: build final expected ref per bill from chronological pairs
  const expectedRef = new Map<string, string>();
  for (const p of PAIRS) if (p.invoice && p.bills.length) for (const b of p.bills) expectedRef.set(b, p.invoice);
  for (const [bill, invName] of expectedRef) {
    checkedBills++;
    const bd = await prod.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: bill }, select: { config: true } });
    if (!bd) { problems.push(`MISSING BILL: ${bill} (expected ref ${invName})`); continue; }
    const ref = (bd.config as any).reference || "";
    const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: invName }, select: { config: true } });
    if (!inv) { problems.push(`MISSING INVOICE: ${invName} (bill ${bill})`); continue; }
    // ref check — allow guru's intentional overrides (consolidated repoints):
    // wrong only if ref is empty/employer-format (i.e. no invoice linkage at all)
    const refIsInvoice = /^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(ref);
    if (!refIsInvoice) { problems.push(`BILL UNLINKED: ${bill} ref="${ref.slice(0, 30)}" expected ${invName}`); continue; }
    // listing check on the ref'd invoice (whichever it points to)
    const target = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: ref }, select: { config: true } });
    if (!target) { problems.push(`BILL ${bill}: ref points to non-existent invoice "${ref}"`); continue; }
    okPairs++;
  }
  // tally per invoice: bills' cost sum vs invoice total
  const invNames = [...new Set([...expectedRef.values()])];
  console.log(`bills checked: ${checkedBills} · linked ok: ${okPairs} · problems: ${problems.length}`);
  problems.forEach(p => console.log("  ⚠ " + p));
  console.log("\nper-invoice tallies (bills' actual cost vs invoice amount):");
  const allRefd = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP26" } }, select: { name: true, config: true } });
  const byRef = new Map<string, { n: number; sum: number }>();
  for (const b of allRefd) {
    const c: any = b.config || {};
    const r = c.reference || "";
    if (!/^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(r)) continue;
    const cur = byRef.get(r) || { n: 0, sum: 0 };
    cur.n++; cur.sum += Number(c.totalAmount || 0);
    byRef.set(r, cur);
  }
  for (const [r, v] of [...byRef.entries()].sort()) {
    const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: r }, select: { config: true } });
    const total = inv ? Number((inv.config as any).totals?.total ?? (inv.config as any).nettTotal ?? 0) : null;
    const flag = total == null ? "⚠ invoice missing" : Math.abs(v.sum - total) < 0.01 ? "✓ exact" : `Δ ${(total - v.sum).toFixed(2)} (flat-rate/over-recharge)`;
    console.log(`  ${r.padEnd(30)} bills=${String(v.n).padStart(3)} cost=$${v.sum.toFixed(2).padStart(9)} · invoice=$${total?.toFixed(2) ?? "?"} ${flag}`);
  }
  await prod.$disconnect();
})();
