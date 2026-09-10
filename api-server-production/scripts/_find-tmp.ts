import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tmp = await prisma.document.findMany({ where: { organizationId: ORG, name: { startsWith: "TMP-" } }, select: { id: true, name: true, status: true, config: true }, orderBy: { name: "asc" } });
  console.log(`${tmp.length} TMP-named documents:`);
  for (const d of tmp) console.log(`  ${d.name} [${d.status}] $${(d.config as any)?.nettTotal ?? "?"} ref=${String((d.config as any)?.reference || "").slice(0, 50)}`);
  process.exit(0);
})();
