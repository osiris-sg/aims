import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, status: true, config: true } });
  for (const d of docs) {
    const blob = JSON.stringify(d.config || {});
    if (!/MG20250085|Lentor/i.test(blob)) continue;
    const c: any = d.config;
    console.log(`${d.name} [${d.status}] $${c.nettTotal ?? "?"} date=${String(c.date || "").slice(0, 10)} · ${String(c.reference || "").slice(0, 70)}`);
  }
  process.exit(0);
})();
