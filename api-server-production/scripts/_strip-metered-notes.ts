// Guru 2026-09-09: only the MBR-30 chain (REC-031) is metered. Remove the
// "METERED — fill qty…" note wrongly stamped on 5 flat-rate chains + their drafts.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  for (const t of tpls) {
    if (t.code === "REC-031") continue;
    const c: any = t.config;
    if (typeof c.note === "string" && /METERED/i.test(c.note)) {
      await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, note: "" } } });
      console.log(`✓ template ${t.code} note cleared (${t.name.slice(0, 40)})`);
    }
  }
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202609" } } });
  for (const d of docs) {
    if (d.name === "BI202609031") continue;
    const c: any = d.config;
    if (typeof c.note === "string" && /METERED/i.test(c.note)) {
      await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, note: "" } } });
      console.log(`✓ draft ${d.name} note cleared`);
    }
  }
  process.exit(0);
})();
