// Any invoice, any customer, any numbering, whose content mentions the
// Bukit Panjang set: MG20250058 or DO202607-015 (or Bukit Panjang).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "CREDIT_NOTE"] } }, select: { name: true, status: true, createdAt: true, config: true } });
  let n = 0;
  for (const d of docs) {
    const blob = JSON.stringify(d.config || {});
    if (!/MG20250058|202607-015|Bukit\s*Panjang/i.test(blob)) continue;
    const c: any = d.config;
    const date = String(c.date || c.documentInfo?.date || "").slice(0, 10);
    n++;
    console.log(`${d.name} [${d.status}] $${c.nettTotal ?? "?"} date=${date} cust=${String(c.customerName || "").slice(0, 30)} · ${String(c.reference || "").slice(0, 60)}`);
  }
  console.log(`\n${n} documents mention MG20250058 / DO202607-015 / Bukit Panjang`);
  process.exit(0);
})();
