import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const dos = await prisma.document.findMany({ where: { organizationId: ORG, type: "DELIVERY_ORDER", OR: [{ name: { startsWith: "DO202608" } }, { name: { startsWith: "RTN-DO202608" } }] }, select: { name: true, status: true, config: true }, orderBy: { name: "asc" } });
  for (const d of dos) {
    const c: any = d.config;
    console.log(`${d.name.padEnd(18)} [${d.status}] ${(c.date || "").slice(0, 10)} · ${(c.customerName || "?").slice(0, 38)}`);
  }
  console.log(`\ntotal: ${dos.length}`);
  process.exit(0);
})();
