import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const name of ["BI202609082", "BI202609085"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name } });
    const c: any = d!.config;
    const cust = await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true, address: true } });
    console.log(`${name} → customer: ${cust?.name || "MISSING ROW"} · address: ${JSON.stringify(cust?.address || null)} · ref=${String(c.reference || "").slice(0, 50)}`);
  }
  process.exit(0);
})();
