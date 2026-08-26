import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL", name: { startsWith: "JP2605260001" } }, select: { name: true, status: true, config: true } });
  for (const d of docs) {
    const c: any = d.config;
    const di: any = c.documentInfo || {};
    console.log(`${d.name} status=${d.status} billStatus=${c.billStatus} taxCode=${di.taxCode} di.subTotal=${di.subTotal} c.subtotal=${c.subtotal} totalAmount=${c.totalAmount} taxAmount=${c.taxAmount} xeroGross=${c.xeroGross} xeroStatus=${c.xeroStatus} date=${c.billDate || c.date}`);
  }
  process.exit(0);
})();
