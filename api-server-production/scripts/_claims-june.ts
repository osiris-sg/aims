// All June 2026 entries on the claims/petty-cash accounts.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const code of ["103", "106", "106-2", "420", "491"]) {
    const acct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code }, select: { id: true, name: true } });
    if (!acct) continue;
    const lines = await prisma.journalEntryLine.findMany({
      where: { accountId: acct.id, journalEntry: { entryDate: { gte: new Date("2026-06-01"), lt: new Date("2026-07-01") } } },
      select: { debit: true, credit: true, description: true, journalEntry: { select: { entryDate: true, reference: true, journalNumber: true } } },
    });
    lines.sort((a, b) => a.journalEntry.entryDate.getTime() - b.journalEntry.entryDate.getTime());
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    console.log(`\n═══ ${code} ${acct.name} — June 2026: ${lines.length} lines · Dr $${dr.toFixed(2)} / Cr $${cr.toFixed(2)}`);
    for (const l of lines) {
      const d = Number(l.debit || 0), c = Number(l.credit || 0);
      const txt = (l.description || l.journalEntry.reference || "").replace(/\n/g, " ").trim().slice(0, 78);
      console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0, 10)} ${d ? ("Dr " + d.toFixed(2)).padStart(12) : ("Cr " + c.toFixed(2)).padStart(12)} · ${txt}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message?.slice(0, 120)); process.exit(1); });
