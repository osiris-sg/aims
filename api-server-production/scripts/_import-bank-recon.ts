// Import Xero's reconciled bank activity into AIMS bank-rec:
//   SCB (102) + UOB (104), from 2025-07-01.
//   Lines = reconciled BankTransactions + Payments + BankTransfers.
//   One BankStatementImport per account; lines auto-matched to the GL's
//   xero-import journal lines (same conventions as bank-rec.service autoMatch).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
import { getXeroTokens, xeroGet } from "./xero-migration/_common";
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const SINCE = "2025-07-01";
const DRY = process.argv.includes("--dry");
const dnet = (s: string) => { const m = /\/Date\((\d+)/.exec(s || ""); return m ? new Date(Number(m[1])) : new Date(s); };
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  // Xero bank accounts ↔ AIMS CoA by code
  const xaccts: any = await xeroGet(tokens, "/Accounts", { where: 'Type=="BANK"' });
  const TARGETS = (xaccts.Accounts || []).filter((a: any) => ["102", "104"].includes(a.Code));
  for (const xa of TARGETS) {
    const coa = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: xa.Code }, select: { id: true, name: true } });
    if (!coa) { console.log(`✗ no AIMS CoA for ${xa.Code}`); continue; }
    console.log(`\n═══ ${xa.Code} ${xa.Name} → AIMS ${coa.name}`);
    // idempotency: skip if an import from this source already exists
    const existing = await prisma.bankStatementImport.findFirst({ where: { organizationId: ORG, bankAccountId: coa.id, filename: `xero-reconciled-${xa.Code}.import` } });
    if (existing) { console.log(`  = already imported (${existing.id.slice(0, 8)}) — skipped`); continue; }
    const lines: { date: Date; description: string; reference: string | null; amount: number }[] = [];
    // 1) bank transactions (reconciled receive/spend)
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, "/BankTransactions", { where: `BankAccount.AccountID==Guid("${xa.AccountID}")`, page: String(page) });
      const txs = r.BankTransactions || [];
      for (const t of txs) {
        if (!t.IsReconciled || t.Status === "DELETED") continue;
        const d = dnet(t.DateString || t.Date);
        if (d < new Date(SINCE)) continue;
        const sign = /RECEIVE/.test(t.Type) ? 1 : -1;
        lines.push({ date: d, description: `${t.Contact?.Name || t.Type}${t.Reference ? " — " + t.Reference : ""}`, reference: t.Reference || null, amount: sign * (Number(t.Total) || 0) });
      }
      if (txs.length < 100) break;
    }
    // 2) payments into/out of this account
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, "/Payments", { where: `Account.AccountID==Guid("${xa.AccountID}")`, page: String(page) });
      const ps = r.Payments || [];
      for (const p of ps) {
        if (p.Status === "DELETED" || !p.IsReconciled) continue;
        const d = dnet(p.DateString || p.Date);
        if (d < new Date(SINCE)) continue;
        const isReceive = ["ACCRECPAYMENT", "ARCREDITPAYMENT"].includes(p.PaymentType) || (p.Invoice?.Type === "ACCREC");
        const sign = isReceive ? 1 : -1;
        lines.push({ date: d, description: `${p.Invoice?.Contact?.Name || p.PaymentType} — ${p.Invoice?.InvoiceNumber || p.Reference || "payment"}`, reference: p.Reference || p.Invoice?.InvoiceNumber || null, amount: sign * (Number(p.Amount) || 0) });
      }
      if (ps.length < 100) break;
    }
    lines.sort((a, b) => a.date.getTime() - b.date.getTime());
    const inSum = lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0);
    const outSum = lines.filter(l => l.amount < 0).reduce((s, l) => s + l.amount, 0);
    console.log(`  ${lines.length} reconciled lines since ${SINCE} · in $${inSum.toFixed(2)} out $${outSum.toFixed(2)}`);
    if (DRY || !lines.length) continue;
    const imp = await prisma.bankStatementImport.create({ data: {
      organizationId: ORG, bankAccountId: coa.id, source: "MANUAL",
      filename: `xero-reconciled-${xa.Code}.import`,
      periodStart: lines[0].date, periodEnd: lines[lines.length - 1].date,
      notes: `Imported from Xero reconciled activity (bank transactions + payments) on 2026-08-26`,
      status: "READY", createdBy: "xero-bankrec-import",
    } });
    await prisma.bankStatementLine.createMany({ data: lines.map(l => ({ importId: imp.id, organizationId: ORG, bankAccountId: coa.id, date: l.date, description: l.description.slice(0, 250), reference: l.reference, amount: Math.round(l.amount * 100) / 100, status: "PENDING" })) });
    // match: JE lines on this account (xero-import GL), same conventions as autoMatch
    const jeLines = await prisma.journalEntryLine.findMany({
      where: { accountId: coa.id, journalEntry: { organizationId: ORG, status: "POSTED", entryDate: { gte: new Date(new Date(SINCE).getTime() - 7 * 86400000) } } },
      select: { id: true, debit: true, credit: true, journalEntry: { select: { entryDate: true } } },
    });
    const taken = new Set((await prisma.bankStatementMatch.findMany({ where: { organizationId: ORG }, select: { journalLineId: true } })).map(m => m.journalLineId));
    const created = await prisma.bankStatementLine.findMany({ where: { importId: imp.id } });
    let matched = 0;
    for (const line of created) {
      const wantDebit = line.amount > 0 ? Math.abs(line.amount) : 0;
      const wantCredit = line.amount < 0 ? Math.abs(line.amount) : 0;
      const cands = jeLines.filter(j => !taken.has(j.id)
        && Math.abs(Math.round(j.debit * 100) / 100 - wantDebit) <= 0.005
        && Math.abs(Math.round(j.credit * 100) / 100 - wantCredit) <= 0.005
        && Math.abs(j.journalEntry.entryDate.getTime() - line.date.getTime()) <= 3 * 86400000);
      if (!cands.length) continue;
      const winner = cands.sort((a, b) => Math.abs(a.journalEntry.entryDate.getTime() - line.date.getTime()) - Math.abs(b.journalEntry.entryDate.getTime() - line.date.getTime()))[0];
      taken.add(winner.id);
      await prisma.bankStatementLine.update({ where: { id: line.id }, data: { status: "MATCHED", matchedJournalLineId: winner.id, matchedAt: new Date(), matchedBy: "xero-bankrec-import" } });
      await prisma.bankStatementMatch.create({ data: { organizationId: ORG, lineId: line.id, journalLineId: winner.id, createdBy: "xero-bankrec-import" } });
      matched++;
    }
    console.log(`  ✓ import ${imp.id.slice(0, 8)} created: ${created.length} lines, ${matched} auto-matched, ${created.length - matched} pending`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
