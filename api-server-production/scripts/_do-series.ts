import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const dos = await prisma.document.findMany({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: { startsWith: "DO202608" } }, select: { name: true, status: true, createdAt: true, config: true }, orderBy: { name: "asc" } });
  console.log(`${dos.length} AIMS DOs in DO202608 series:`);
  for (const d of dos) {
    const c: any = d.config;
    console.log(`  ${d.name} [${d.status}] created=${d.createdAt.toISOString().slice(0, 10)} cust=${(c.customerName || c.customer?.name || c.billTo?.split("\n")[0] || "?").slice(0, 35)}`);
  }
  // also RTN returns
  const rtn = await prisma.document.findMany({ where: { organizationId: ORG, name: { contains: "RTN" }, createdAt: { gte: new Date("2026-08-01") } }, select: { name: true, type: true }, orderBy: { name: "asc" } });
  console.log(`\nreturn DOs in Aug: ${rtn.map(r => r.name).join(", ") || "none"}`);
  process.exit(0);
})();
