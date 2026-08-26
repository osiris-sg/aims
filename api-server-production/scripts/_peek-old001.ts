import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findUnique({ where: { id: (await prisma.document.findFirst({ where: { organizationId: ORG, name: "DO202608-001", type: "DO" }, select: { id: true } }))!.id } });
  const c: any = d!.config;
  console.log(JSON.stringify(c, null, 1).slice(0, 900));
  process.exit(0);
})();
