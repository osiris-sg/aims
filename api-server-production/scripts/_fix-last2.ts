import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  // 1) GB2600026237 — why does AIMS count it as taxable purchase?
  const gb = await prisma.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: "GB2600026237" } });
  const c: any = gb!.config;
  const di: any = c.documentInfo || {};
  console.log(`GB2600026237: taxCode=${di.taxCode} gst=${di.gstAmount ?? c.taxAmount} typedLines=${JSON.stringify((c.items || []).filter((i: any) => i.taxType).map((i: any) => ({ t: i.taxType, a: i.amount })))}`);
  // clear whatever makes it count
  const items = (c.items || []).map((it: any) => it.taxType ? { ...it, taxType: null } : it);
  await prisma.document.update({ where: { id: gb!.id }, data: { config: { ...c, items, documentInfo: { ...di, taxCode: null } } } });
  console.log("✓ cleared input coding (wharfage = no GST, matches Xero NONE lines)");
  // 2) Xero 078 — who is it and where's its AIMS mirror?
  const tokens = await getXeroTokens(null as any, ORG);
  const q: any = await xeroGet(tokens, "/Invoices", { where: `InvoiceNumber=="BI202608078"` });
  for (const inv of q.Invoices || []) {
    console.log(`\nXero 078: [${inv.Status}] $${inv.Total} tax=$${inv.TotalTax} · ${inv.Contact?.Name} · id=${inv.InvoiceID.slice(0, 8)}`);
    const aims = await prisma.document.findFirst({ where: { organizationId: ORG, config: { path: ["xeroInvoiceId"], equals: inv.InvoiceID } }, select: { id: true, name: true, status: true, config: true } });
    if (!aims) { console.log("   AIMS mirror: NONE"); continue; }
    const ac: any = aims.config;
    const adi: any = ac.documentInfo || {};
    console.log(`   AIMS: ${aims.name} [${aims.status}] taxCode=${adi.taxCode} sub=${adi.subTotal ?? ac.subTotal} gst=${adi.gstAmount ?? ac.gstAmount}`);
    if (["AUTHORISED", "PAID"].includes(inv.Status) && (aims.status === "draft" || !adi.taxCode)) {
      await prisma.document.update({ where: { id: aims.id }, data: { status: (inv.Status === "PAID" ? "paid" : "confirmed") as any, config: { ...ac, xeroStatus: inv.Status, subTotal: inv.SubTotal, gstAmount: inv.TotalTax, nettTotal: inv.Total, documentInfo: { ...adi, taxCode: "1", subTotal: inv.SubTotal, gstAmount: inv.TotalTax } } } });
      console.log("   ✓ mirrored status + F5 fields");
    }
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
