import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const name of ["DO202608-0019", "DO202608-0040", "DO202608-0041", "DO202608-0007"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name }, select: { name: true, config: true } });
    const c: any = d?.config || {};
    console.log(`${name}: items=${JSON.stringify((c.items || []).map((i: any) => ({ code: i.itemCode, sn: i.serialNumbers })))} cust=${c.customerName}`);
  }
  const rdo = await prisma.document.findMany({ where: { organizationId: ORG, name: { startsWith: "RDO" } }, select: { name: true, type: true, status: true, config: true } });
  console.log(`\nRDO docs: ${rdo.length}`);
  for (const r of rdo) console.log(`  ${r.name} [${r.type}/${r.status}] cust=${(r.config as any)?.customerName} date=${((r.config as any)?.date || "").slice(0, 10)}`);
  const types = await prisma.document.groupBy({ by: ["type"], where: { organizationId: ORG, type: { contains: "RETURN" } }, _count: true } as any);
  console.log("RETURN-ish types:", JSON.stringify(types));
  process.exit(0);
})();
