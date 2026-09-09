import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const o = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true, bankDetails: true, updatedAt: true } });
  console.log(o!.name, "· updatedAt:", o!.updatedAt.toISOString());
  console.log("bankDetails:", JSON.stringify(o!.bankDetails, null, 1));
  process.exit(0);
})();
