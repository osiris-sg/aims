import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, OR: [{ name: { startsWith: "DO-PENDING" } }, { name: { startsWith: "RDO-PENDING" } }, { AND: [{ type: { contains: "DELIVERY" } }, { status: { in: ["draft", "unconfirmed"] as any } }] }] }, select: { name: true, type: true, status: true, createdAt: true, config: true }, orderBy: { createdAt: "desc" } });
  console.log(`${docs.length} pending/unconfirmed delivery docs:`);
  for (const d of docs) {
    const c: any = d.config;
    let cust = c.customerName || "";
    if (!cust && c.customerId) { const cu = await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true } }); cust = cu?.name || ""; }
    const items = (c.items || []).map((i: any) => String(i.description || "").split("\n")[0]).join(" + ").slice(0, 60);
    console.log(`  ${d.name.padEnd(18)} [${d.status}] ${String(c.date || "").slice(0, 10) || "no-date"} · ${cust.slice(0, 28).padEnd(28)} · ${items}`);
  }
  process.exit(0);
})();
