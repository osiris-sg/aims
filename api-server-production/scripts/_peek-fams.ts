import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const base of ["JP2604270179", "JP2605020025", "JP2605160026"]) {
    const ds = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: base.slice(0, 12) } }, select: { name: true, status: true, config: true } });
    if (!ds.length) { console.log(`${base}: NOT IN AIMS`); continue; }
    for (const d of ds) {
      const c: any = d.config; const di: any = c.documentInfo || {};
      console.log(`${d.name} [${d.status}] taxCode=${di.taxCode} amountsAre=${c.amountsAre} sub=${di.subTotal ?? c.subtotal} tax=${di.gstAmount ?? c.taxAmount} gross=${c.xeroGross ?? c.totalAmount} items=${JSON.stringify((c.items || []).map((i: any) => ({ t: i.taxType, a: i.amount, x: i.taxAmount })))}`);
    }
  }
  process.exit(0);
})();
