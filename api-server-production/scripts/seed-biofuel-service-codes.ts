/**
 * Register the service codes Biofuel already invoices with, but which were
 * never added to Account Mapping (guru 2026-09-29).
 *
 * The screen showed 7 services; documents use 20. SV003 alone is on 1,009
 * lines across 525 documents. Because they are unmapped, nothing self-codes —
 * each line carries whatever accountCode was typed at the time.
 *
 * NO NEW ACCOUNTING DECISIONS: each row is seeded with the account code those
 * lines ALREADY post to. Every code was checked and uses exactly one account
 * across its whole history, so this documents current behaviour rather than
 * changing it. Names are taken from the GL account each maps to.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs"; import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production","utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const APPLY = process.argv.includes("--apply");

const SERVICES: Array<{ code: string; name: string; accountCode: string; note?: string }> = [
  { code: "SV001", name: "Rental of MBR System",              accountCode: "200" },
  { code: "SV002", name: "Rental of APF/AFS System",          accountCode: "201" },
  { code: "SV003", name: "Transportation / Disposal of Hardcore", accountCode: "202", note: "1,009 lines — line text usually reads 'Disposal of Bore Out Soil'" },
  { code: "SV004", name: "Rental of Machinery / Trailers",    accountCode: "203" },
  { code: "SV006", name: "Rental of SIDS / TSS System",       accountCode: "207" },
  { code: "SV007", name: "Disposal of Waste Materials",       accountCode: "209" },
  { code: "SV008", name: "Polymax-B",                         accountCode: "210" },
  { code: "SV009", name: "Consumables / Spare Parts",         accountCode: "211" },
  { code: "SV010", name: "Rental of ISO Tank / FRP Tank",     accountCode: "212" },
  { code: "SV011", name: "Rental of Generator",               accountCode: "213" },
  { code: "SV012", name: "Rental of Micro-Grid System",       accountCode: "214" },
  { code: "SV014", name: "Rental of Excavator",               accountCode: "222" },
  { code: "SV015", name: "Rental Income (land usage etc.)",   accountCode: "223" },
  { code: "SV025", name: "JP Pass Application (recharge)",    accountCode: "443", note: "443 is an EXPENSE account — a recharge mapping, which this screen supports" },
];

(async () => {
  const accounts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true } });
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const existing = new Set((await prisma.revenueItem.findMany({ where: { organizationId: ORG }, select: { code: true } })).map((r) => r.code));
  let created = 0, skipped = 0;
  for (const s of SERVICES) {
    if (existing.has(s.code)) { skipped++; console.log(`  = ${s.code} already mapped`); continue; }
    const acct = byCode.get(s.accountCode);
    if (!acct) { console.log(`  ✗ ${s.code}: account ${s.accountCode} not in the AIMS chart — skipped`); continue; }
    console.log(`  ${APPLY ? "+" : "would add"} ${s.code.padEnd(7)} ${s.name.padEnd(42)} → ${s.accountCode} ${acct.name}${s.note ? `   [${s.note}]` : ""}`);
    if (APPLY) {
      await prisma.revenueItem.create({
        data: { organizationId: ORG, code: s.code, name: s.name, type: "SERVICE", accountCode: s.accountCode, accountId: acct.id, isActive: true },
      });
      await prisma.actionLog.create({ data: {
        actorType: "SYSTEM", actorId: "system:seed-service-codes", actorName: "System creation",
        organizationId: ORG, channel: "cron", action: "CREATE", resource: "revenue-item",
        details: { code: s.code, name: s.name, accountCode: s.accountCode, note: "backfilled from codes already used on invoices" },
      } });
    }
    created++;
  }
  console.log(`\n${APPLY ? "created" : "would create"} ${created} · already mapped ${skipped}`);
  process.exit(0);
})();
