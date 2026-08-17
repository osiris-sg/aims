// AIMS-only: regroup the 65 clean drafts' running numbers so customers sort
// alphabetically and each customer's invoices are consecutive. Pool = exactly
// the 65 slots these drafts already hold (no new slots claimed).
// Xero NOT touched — config.xeroInvoiceNumber keeps Xero's current number;
// pendingXeroRenumber flags the follow-up push.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");
const EXCLUDE = new Set(["BI202608031"]); // approved one only — everything else joins the strict A-Z run
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push" && !EXCLUDE.has(d.name!));
  const custIds = [...new Set(ours.map(d => (d.config as any).customerId).filter(Boolean))] as string[];
  const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } });
  const nameById = new Map(custs.map(c => [c.id, c.name]));
  const pool = ours.map(d => parseInt(d.name!.slice(-3), 10)).sort((a, b) => a - b);
  const sorted = [...ours].sort((a, b) => {
    const ca = (nameById.get((a.config as any).customerId) || "").toLowerCase();
    const cb = (nameById.get((b.config as any).customerId) || "").toLowerCase();
    return ca.localeCompare(cb) || a.name!.localeCompare(b.name!);
  });
  console.log(`${sorted.length} drafts, pool ${pool[0]}–${pool[pool.length - 1]} (${pool.length} slots)`);
  const plan = sorted.map((d, i) => ({ d, newNo: `BI202608${String(pool[i]).padStart(3, "0")}` }));
  let lastCust = "";
  for (const p of plan) {
    const cust = nameById.get((p.d.config as any).customerId) || "?";
    if (cust !== lastCust) { console.log(`\n— ${cust}`); lastCust = cust; }
    console.log(`   ${p.d.name} → ${p.newNo}${p.d.name === p.newNo ? " (unchanged)" : ""}`);
  }
  if (DRY) { console.log("\n[DRY] no writes"); process.exit(0); }
  // two-phase rename to dodge the (name, org, templateId) unique constraint
  for (const p of plan) if (p.d.name !== p.newNo) await prisma.document.update({ where: { id: p.d.id }, data: { name: `TMP-${p.d.id.slice(0, 8)}` } });
  for (const p of plan) {
    if (p.d.name === p.newNo) continue;
    const c: any = p.d.config;
    await prisma.document.update({ where: { id: p.d.id }, data: { name: p.newNo, config: { ...c, documentNumber: p.newNo, alphaRenumberedFrom: p.d.name, pendingXeroRenumber: true } } });
  }
  console.log(`\n✓ renamed ${plan.filter(p => p.d.name !== p.newNo).length} in AIMS (Xero untouched — pendingXeroRenumber set)`);
  process.exit(0);
})();
