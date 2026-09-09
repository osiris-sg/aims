// One-off: align REC codes with current slots in prod (deployed code predates
// the code-follows-slot rule).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const slotted = tpls
    .map(t => ({ t, slot: parseInt((/\{MONTH NO\}(\d{3})$/.exec(String((t.config as any)?.documentNumber || "")) || [])[1] || "0", 10) }))
    .filter(x => x.slot > 0);
  let n = 0;
  for (const { t, slot } of slotted) {
    const want = `REC-${String(slot).padStart(3, "0")}`;
    if (t.code !== want) { await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { code: want } }); console.log(`  ${t.code} → ${want} · ${t.name.slice(0, 45)}`); n++; }
  }
  console.log(`re-coded ${n}; codes now REC-001…REC-${String(slotted.length).padStart(3, "0")} gap-free`);
  process.exit(0);
})();
