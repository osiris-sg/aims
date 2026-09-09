import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202608078" }, select: { config: true } });
  const c: any = d?.config;
  for (const it of c?.items || []) {
    for (const l of String(it.description || "").split("\n")) if (/dated/i.test(l)) console.log(l.trim());
  }
  process.exit(0);
})();
