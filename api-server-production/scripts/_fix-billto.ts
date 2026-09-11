// Backfill billTo + customerName on Sept drafts and on every template that
// lacks them (source: a sister template of the same customer, else the
// customer master + "Attn: Accounts Dept.").
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const custIds = [...new Set(tpls.map(t => t.customerId))];
  const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true, address: true } });
  const cm = new Map(custs.map(c => [c.id, c]));
  const billToFor = (customerId: string): { billTo: string; name: string } | null => {
    const sister = tpls.find(t => t.customerId === customerId && String((t.config as any)?.billTo || "").trim());
    const cust = cm.get(customerId);
    if (sister) return { billTo: (sister.config as any).billTo, name: cust?.name || "" };
    if (!cust) return null;
    const addr = String(cust.address || "").split(/,\s*/).join("\n");
    return { billTo: `${cust.name}${addr ? "\n" + addr : ""}\nAttn: Accounts Dept.`, name: cust.name };
  };
  // 1) templates
  let tFixed = 0;
  for (const t of tpls) {
    const c: any = t.config;
    if (String(c.billTo || "").trim()) continue;
    const fix = billToFor(t.customerId);
    if (!fix) { console.log(`✗ template ${t.code}: no source for billTo`); continue; }
    await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...c, billTo: fix.billTo } } });
    tFixed++;
    console.log(`✓ template ${t.code} billTo ← ${fix.name.slice(0, 34)}`);
  }
  // 2) Sept drafts
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609099" } } });
  let dFixed = 0;
  for (const d of docs) {
    if (!/^BI202609\d{3}$/.test(d.name!)) continue;
    const c: any = d.config;
    if (String(c.billTo || "").trim() && String(c.customerName || "").trim()) continue;
    const fix = billToFor(c.customerId);
    if (!fix) { console.log(`✗ ${d.name}: no source`); continue; }
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, billTo: c.billTo || fix.billTo, customerName: c.customerName || fix.name } } });
    dFixed++;
    console.log(`✓ ${d.name} ← ${fix.name.slice(0, 34)}`);
  }
  console.log(`\ntemplates fixed: ${tFixed} · drafts fixed: ${dFixed}`);
  process.exit(0);
})();
