import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const CUSTS = ["Prime", "Integrate", "Tanglin", "Woh Hup", "QJI", "Qingjian", "Jiayi", "Jia Yi", "Tenda", "Capital Cranes", "SCB", "Shuan Huat", "Lian Beng", "Kim Heng", "Obayashi"];
(async () => {
  console.log("═══ TEMPLATES ═══");
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  const custRows = await prisma.customer.findMany({ where: { id: { in: [...new Set(tpls.map(t => t.customerId))] } }, select: { id: true, name: true } });
  const cn = new Map(custRows.map(c => [c.id, c.name]));
  for (const t of tpls) {
    const nm = cn.get(t.customerId) || "?";
    if (!CUSTS.some(c => nm.toLowerCase().includes(c.toLowerCase()) || t.name.toLowerCase().includes(c.toLowerCase()))) continue;
    const c: any = t.config;
    console.log(`${t.code} [${t.isActive ? "ACTIVE" : "off"}] ${nm.slice(0, 30)} · $${c.nettTotal ?? "?"} · ${t.name.slice(0, 55)}`);
  }
  console.log("\n═══ SEPT INVOICES (those customers) ═══");
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202609" } }, orderBy: { name: "asc" } });
  for (const d of docs) {
    const c: any = d.config;
    const nm = String(c.customerName || cn.get(c.customerId) || "");
    let name2 = nm;
    if (!name2 && c.customerId) { const cu = await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true } }); name2 = cu?.name || ""; }
    if (!CUSTS.some(x => name2.toLowerCase().includes(x.toLowerCase()))) continue;
    console.log(`${d.name} [${d.status}] $${c.nettTotal} · ${name2.slice(0, 34)} · ${String(c.reference || "").slice(0, 55)}`);
  }
  console.log("\n═══ AUG INVOICES for the NEW chains (any catch-up raised?) ═══");
  const augDocs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", OR: [{ name: { startsWith: "BI202608" } }, { createdAt: { gte: new Date("2026-08-25") } }] }, orderBy: { name: "asc" } });
  for (const d of augDocs) {
    const c: any = d.config;
    let nm = String(c.customerName || "");
    if (!nm && c.customerId) { const cu = await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true } }); nm = cu?.name || ""; }
    if (!["Prime", "Integrate", "Tanglin", "Woh Hup", "QJI", "Jiayi", "Jia Yi", "Kim Heng"].some(x => nm.toLowerCase().includes(x.toLowerCase()))) continue;
    console.log(`${d.name} [${d.status}] $${c.nettTotal} · ${nm.slice(0, 34)}`);
  }
  process.exit(0);
})();
