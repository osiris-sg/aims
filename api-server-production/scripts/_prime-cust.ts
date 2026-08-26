import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const cs = await prisma.customer.findMany({ where: { organizationId: ORG, name: { contains: "Prime", mode: "insensitive" } }, select: { id: true, name: true } });
  console.log(cs.map(c => c.name).join("\n") || "none — creating");
  if (!cs.length) {
    const c = await prisma.customer.create({ data: { organizationId: ORG, name: "Prime Builders Pte Ltd" }, select: { id: true, name: true } });
    console.log("created:", c.name);
  }
  process.exit(0);
})();
