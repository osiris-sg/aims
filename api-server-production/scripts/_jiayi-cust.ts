import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const cs = await prisma.customer.findMany({ where: { organizationId: ORG, OR: [{ name: { contains: "Jia", mode: "insensitive" } }, { name: { contains: "JIAYI", mode: "insensitive" } }] }, select: { id: true, name: true } });
  console.log(cs.map(c => `${c.id.slice(0, 8)} ${c.name}`).join("\n") || "none");
  process.exit(0);
})();
