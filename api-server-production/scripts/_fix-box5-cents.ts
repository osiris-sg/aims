// Box5 exactness: (A) inclusive bills whose stored subtotal = GROSS → store
// net (gross − tax); (B) bills Xero counts but AIMS skips (draft, no
// xeroStatus) → mirror status + code from live Xero.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
(async () => {
  // A) subtotal==gross with tax>0 (doc-level bills)
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL" }, select: { id: true, name: true, status: true, config: true } });
  let fixedNet = 0;
  for (const d of docs) {
    const c: any = d.config;
    if (c.voided) continue;
    const di: any = c.documentInfo || {};
    if (!di.taxCode) continue;
    if ((c.items || []).some((it: any) => it?.taxType)) continue;
    const tax = R(Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0);
    if (tax <= 0) continue;
    const gross = R(Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? 0) || 0);
    const readNet = Number(di.subTotal ?? c.subtotal ?? c.subTotal ?? NaN);
    if (!Number.isFinite(readNet) || !gross) continue;
    if (Math.abs(R(readNet) - gross) > 0.005) continue; // already net
    const net = R(gross - tax);
    const cfg: any = { ...c };
    if (cfg.subtotal !== undefined) cfg.subtotal = net;
    if (cfg.subTotal !== undefined) cfg.subTotal = net;
    cfg.documentInfo = { ...di, ...(di.subTotal !== undefined ? { subTotal: net } : {}) };
    await prisma.document.update({ where: { id: d.id }, data: { config: cfg } });
    fixedNet++;
  }
  console.log(`A) subtotal gross→net on ${fixedNet} bills`);
  // B) the skipped-but-counted bills: match live Xero by base name
  const tokens = await getXeroTokens(null as any, ORG);
  const targets = docs.filter(d => (d.status as any) === "draft" && !(d.config as any).voided);
  let fixedStatus = 0;
  for (const d of targets) {
    const c: any = d.config;
    const base = (d.name || "").split(" (")[0].split(" ·")[0].trim();
    const r: any = await xeroGet(tokens, "/Invoices", { where: `Type=="ACCPAY"&&InvoiceNumber.StartsWith("${base}")`, page: "1" }).catch(() => null);
    const live = (r?.Invoices || []).find((i: any) => ["AUTHORISED", "PAID"].includes(i.Status));
    if (!live) continue;
    const di: any = c.documentInfo || {};
    const hasInput = (live.LineItems || []).some((l: any) => ["TAX002", "INPUTY24", "INPUTY23", "INPUT"].includes(l.TaxType));
    await prisma.document.update({ where: { id: d.id }, data: { status: (live.Status === "PAID" ? "paid" : "confirmed") as any, config: { ...c, xeroStatus: live.Status, documentInfo: { ...di, ...(hasInput && !di.taxCode ? { taxCode: "4" } : {}) } } } });
    fixedStatus++;
  }
  console.log(`B) status+code mirrored on ${fixedStatus} skipped bills`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
