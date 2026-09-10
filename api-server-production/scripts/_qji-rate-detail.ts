import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const n of ["BI202602073", "BI202603086", "BI202601065"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: n }, select: { name: true, config: true } });
    const c: any = d?.config;
    console.log(`\n${n} $${c?.nettTotal}`);
    for (const it of (c?.items || []).slice(0, 5)) console.log(`  amt=${it.amount} :: ${String(it.description || "").replace(/\n/g, " ¶ ").slice(0, 95)}`);
  }
  process.exit(0);
})();
