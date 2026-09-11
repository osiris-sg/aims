import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const pat of ["Jiayi", "Integrate"]) {
    const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, name: { contains: pat } } });
    if (!t) { console.log(`= ${pat}: no template`); continue; }
    await prisma.recurringInvoiceTemplate.delete({ where: { id: t.id } });
    console.log(`✓ deleted ${t.code} · ${t.name.slice(0, 50)}`);
  }
  process.exit(0);
})();
