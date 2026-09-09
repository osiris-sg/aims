import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const n of ["BI202609017", "BI202609018", "BI202609081", "BI202609082"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n }, select: { config: true } });
    const c: any = d?.config;
    const cust = c?.customerId ? await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true } }) : null;
    console.log(`${n} → ${cust?.name || "no customer link"}`);
  }
  process.exit(0);
})();
