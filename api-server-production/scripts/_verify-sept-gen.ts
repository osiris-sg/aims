import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202609" }, createdAt: { gte: new Date(Date.now() - 60 * 60000) } }, select: { name: true, status: true, config: true }, orderBy: { name: "asc" } });
  let tot = 0, refOk = 0, dateOk = 0;
  for (const d of docs) { const c: any = d.config; tot += Number(c.nettTotal) || 0; if ((c.reference || "").startsWith(d.name!)) refOk++; if ((c.date || "").startsWith("2026-09-01")) dateOk++; }
  console.log(`generated: ${docs.length} docs · $${Math.round(tot * 100) / 100} · refs-start-with-own-number: ${refOk} · dated 01/09: ${dateOk}`);
  console.log("first:", docs[0]?.name, "· last:", docs[docs.length - 1]?.name);
  const s: any = docs.find(d => d.name === "BI202609005")?.config;
  if (s) {
    console.log(`\nBI202609005: ref="${s.reference}" · ${s.subTotal}+${s.gstAmount}=${s.nettTotal} · terms=${s.paymentTerms}`);
    for (const it of (s.items || []).slice(0, 4)) console.log(` qty=${JSON.stringify(it.quantity)} up=${JSON.stringify(it.unitPrice)} amt=${JSON.stringify(it.amount)} :: ${(it.description || "").slice(0, 55)}`);
  }
  const remaining = await prisma.recurringInvoiceTemplate.count({ where: { organizationId: ORG, isActive: true, nextRunDate: { lte: new Date() } } });
  console.log(`\ntemplates still due (0 = all generated): ${remaining}`);
  process.exit(0);
})();
