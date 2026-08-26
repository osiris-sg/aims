import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const ds = await prisma.document.findMany({ where: { organizationId: ORG, type: "DO" }, select: { name: true, status: true, createdAt: true, config: true }, orderBy: { name: "asc" } });
  console.log(`${ds.length} docs of type "DO":`);
  for (const d of ds) {
    const c: any = d.config;
    const sn = (c.items || []).flatMap((i: any) => i.serialNumbers || []).join(",");
    console.log(`  ${d.name} [${d.status}] created=${d.createdAt.toISOString().slice(0, 10)} sn=${sn.slice(0, 50)} src=${c.source ? "uploaded" : "—"}`);
  }
  process.exit(0);
})();
