/**
 * Backfill the canonical money keys on Document.config (guru 2026-09-28).
 *
 *   xeroBalance    → outstandingBalance
 *   xeroAmountPaid → paidToDate     (NOT amountPaid — that key already exists with a different meaning)
 *   xeroGross      → totalWithTax   (NOT grossTotal — that key already means the pre-GST subtotal)
 *
 * These are AIMS's own numbers; the xero* names are historical. Readers already
 * prefer the canonical key and fall back to the legacy one, so this backfill is
 * safe to run at any time and safe to re-run. The legacy keys are KEPT for now —
 * writers still stamp both — so nothing outside this repo breaks. Drop them in a
 * later pass once nothing reads them.
 *
 * Also removes xeroRemainingCredit, which has zero readers anywhere.
 *
 * Usage: npx ts-node --transpile-only scripts/backfill-document-money.ts [--env=.env] [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs"; import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ENV = process.argv.find(a => a.startsWith("--env="))?.split("=")[1] || ".env.production";
const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(ENV, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const num = (v: any) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));

(async () => {
  const docs = await prisma.document.findMany({ select: { id: true, name: true, organizationId: true, config: true } });
  let touched = 0, bal = 0, paid = 0, gross = 0, dropped = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    const next: any = { ...c };
    let change = false;
    if (next.outstandingBalance === undefined && num(c.xeroBalance) !== null) { next.outstandingBalance = num(c.xeroBalance); bal++; change = true; }
    if (next.paidToDate === undefined && num(c.xeroAmountPaid) !== null) { next.paidToDate = num(c.xeroAmountPaid); paid++; change = true; }
    if (next.totalWithTax === undefined && num(c.xeroGross) !== null) { next.totalWithTax = num(c.xeroGross); gross++; change = true; }
    if (next.xeroRemainingCredit !== undefined) { delete next.xeroRemainingCredit; dropped++; change = true; }
    if (!change) continue;
    touched++;
    if (APPLY) await prisma.document.update({ where: { id: d.id }, data: { config: next } });
  }
  console.log(`${ENV}: ${docs.length} documents scanned`);
  console.log(`  ${APPLY ? "updated" : "would update"} ${touched}`);
  console.log(`    outstandingBalance set : ${bal}`);
  console.log(`    paidToDate set         : ${paid}`);
  console.log(`    totalWithTax set       : ${gross}`);
  console.log(`    xeroRemainingCredit removed: ${dropped}`);
  process.exit(0);
})();
