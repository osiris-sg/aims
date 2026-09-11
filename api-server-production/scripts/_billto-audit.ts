import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609099" } }, orderBy: { name: "asc" } });
  let missing = 0;
  for (const d of docs) {
    if (!/^BI202609\d{3}$/.test(d.name!)) continue;
    const c: any = d.config;
    const bt = String(c.billTo || "").trim();
    const cn = String(c.customerName || "").trim();
    if (!bt) { missing++; console.log(`${d.name} [${d.status}] billTo=EMPTY customerName=${cn || "EMPTY"} customerId=${c.customerId ? "yes" : "NO"}`); }
  }
  console.log(`\n${missing} September invoices without billTo`);
  process.exit(0);
})();
