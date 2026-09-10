// Unconfirm the 10 AIMS-confirmed Sept invoices (guru 2026-09-09): doc status
// back to "unconfirmed"; journals STAY posted but flip isUnconfirmed=true
// (the 2026-07-24 two-layer GL model — journals are never deleted, only
// re-labelled).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const NAMES = ["BI202609001","BI202609004","BI202609005","BI202609008","BI202609009","BI202609010","BI202609011","BI202609012","BI202609013","BI202609030"];
const APPLY = process.argv.includes("--apply");
(async () => {
  for (const name of NAMES) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name } });
    if (!d) { console.log(`✗ ${name} not found`); continue; }
    const jes = await prisma.journalEntry.findMany({ where: { organizationId: ORG, OR: [{ sourceDocumentId: d.id }, { reference: { contains: name } }] } });
    console.log(`${name} [${d.status}] → ${jes.map(j => `${j.journalNumber} [${j.status}${j.isUnconfirmed ? "/unconf" : "/CONF"}] $${j.totalDebit}`).join(" · ") || "no journal"}`);
    if (APPLY) {
      for (const j of jes) if (!j.isUnconfirmed && j.status === "POSTED") await prisma.journalEntry.update({ where: { id: j.id }, data: { isUnconfirmed: true } });
      const c: any = d.config || {};
      const { paymentStatus, paymentStatusSource, ...rest } = c;
      await prisma.document.update({ where: { id: d.id }, data: { status: "unconfirmed" as any, config: rest } });
      console.log(`   ✓ doc → unconfirmed, ${jes.filter(j => !j.isUnconfirmed && j.status === "POSTED").length} journal(s) re-tagged unconfirmed`);
    }
  }
  console.log(APPLY ? "\nDONE" : "\nDRY RUN");
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
