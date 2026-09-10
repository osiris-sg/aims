import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, name: { in: ["BIPL-EW-INV-20260909-0056", "BIPL-EW-INV-20260909-0057"] } } });
  for (const d of docs) {
    const c: any = d.config;
    console.log(`${d.name} [${d.status}] createdBy=${c.createdBy || "?"} sub=${c.subTotal} nett=${c.nettTotal} total=${c.total}`);
    for (const it of (c.items || []).slice(0, 6)) console.log(`  qty=${it.quantity} up=${it.unitPrice} amt=${it.amount} :: ${String(it.description || "").replace(/\n/g, " ¶ ").slice(0, 80)}`);
  }
  process.exit(0);
})();
