import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const code of ["801", "103", "106", "106-2", "420", "491"]) {
    const acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code }, select: { id: true, name: true } });
    if (!acct) { console.log(code, "not found"); continue; }
    const lines = await prisma.journalEntryLine.findMany({ where: { accountId: acct.id }, select: { debit: true, credit: true, description: true, journalEntry: { select: { entryDate: true, reference: true } } }, take: 2000 });
    const recent = lines.filter(l => l.journalEntry.entryDate >= new Date("2026-06-01"));
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    console.log(`${code.padEnd(6)} ${acct.name.padEnd(40)} lines=${lines.length} sinceJun26=${recent.length} ΣDr=$${Math.round(dr).toLocaleString()}`);
    for (const l of recent.slice(0, 2)) console.log(`    e.g. ${l.journalEntry.entryDate.toISOString().slice(0, 10)} ${(l.description || l.journalEntry.reference || "").slice(0, 75)}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message?.slice(0, 150)); process.exit(1); });
