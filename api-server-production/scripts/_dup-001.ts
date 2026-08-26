import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const ds = await prisma.document.findMany({ where: { organizationId: ORG, name: "DO202608-001" }, select: { id: true, type: true, status: true, createdAt: true, documentTemplateId: true, config: true } });
  for (const d of ds) console.log(`${d.id.slice(0, 8)} [${d.type}/${d.status}] created=${d.createdAt.toISOString().slice(0, 16)} tpl=${d.documentTemplateId.slice(0, 8)} keys=${Object.keys(d.config as any).length} cust=${(d.config as any)?.customerName}`);
  process.exit(0);
})();
