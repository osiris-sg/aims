import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const cust = await prisma.customer.findMany({ where: { organizationId: ORG, name: { contains: "Integrate", mode: "insensitive" } }, select: { name: true, id: true } });
  console.log("customers:", cust.map(c => c.name).join(", ") || "none");
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, createdAt: { gte: new Date("2026-08-01") } }, select: { name: true, type: true, status: true, config: true } });
  for (const d of docs) {
    const blob = JSON.stringify(d.config).slice(0, 20000);
    if (/integrate|joo\s*koon/i.test(blob)) console.log(`doc hit: ${d.name} [${d.type}/${d.status}]`);
  }
  const d38 = docs.find(d => d.name === "DO202608-0038");
  if (d38) { const c: any = d38.config; console.log(`\nDO202608-0038: cust=${c.customerName || c.customer?.name || c.billTo} items=${JSON.stringify((c.items || []).map((i: any) => i.description || i.name).slice(0, 3))}`); }
  process.exit(0);
})();
