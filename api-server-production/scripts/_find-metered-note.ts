import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202609" } }, select: { name: true, status: true, config: true }, orderBy: { name: "asc" } });
  for (const d of docs) {
    const c: any = d.config;
    const blob = JSON.stringify(c);
    if (/METERED/i.test(blob)) {
      console.log(`${d.name} [${d.status}] $${c.nettTotal ?? "?"} · ${(c.customerName || c.customer?.name || "?").slice(0, 40)}`);
      console.log(`   ref: ${(c.reference || "").slice(0, 90)}`);
    }
  }
  process.exit(0);
})();
