import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const fmts = await prisma.documentNumberFormat.findMany({ where: { organizationId: ORG }, orderBy: [{ documentType: "asc" }, { sortOrder: "asc" }] });
  for (const f of fmts) {
    if (!/INVOICE|TI/i.test(f.documentType)) continue;
    console.log(`type=${f.documentType.padEnd(10)} sort=${f.sortOrder} active=${f.isActive} "${f.name}" pattern=${f.pattern} nextSerial=${f.nextSerial} reset=${f.resetPolicy ?? "never"}`);
  }
  console.log("\nall types present:", [...new Set(fmts.map(f => f.documentType))].join(", "));
  process.exit(0);
})();
