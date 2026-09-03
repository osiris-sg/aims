// How do text-only lines look across the 89 templates right now?
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  let bad = 0, ok = 0, badTpls: string[] = [];
  for (const t of tpls) {
    const items: any[] = (t.config as any)?.items || [];
    let dirty = false;
    for (const it of items) {
      const amt = Number(it.amount) || 0, up = Number(it.unitPrice) || 0;
      if (amt === 0 && up === 0) {
        // text line: must be qty null + unitPrice null + amount null
        if (it.quantity != null || it.unitPrice != null || it.amount != null || it.tax != null) dirty = true;
      }
    }
    if (dirty) { bad++; badTpls.push(t.code!); } else ok++;
  }
  console.log(`templates with non-blank text lines: ${bad} / ${tpls.length}`);
  console.log(badTpls.slice(0, 15).join(", ") + (badTpls.length > 15 ? " …" : ""));
  // sample one
  const s = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: badTpls[0] || "REC-005" } });
  for (const it of ((s!.config as any).items || []).slice(0, 5)) console.log(` qty=${JSON.stringify(it.quantity)} up=${JSON.stringify(it.unitPrice)} amt=${JSON.stringify(it.amount)} tax=${JSON.stringify(it.tax)} :: ${(it.description || "").slice(0, 60)}`);
  process.exit(0);
})();
