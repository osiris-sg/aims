// True up the 71 drafts' F5-visible amounts from live Xero (she edits before
// authorising): di.subTotal/gstAmount + c.subTotal/gstAmount/nettTotal.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let updated = 0;
  for (let i = 0; i < ours.length; i += 40) {
    const chunk = ours.slice(i, i + 40);
    const r: any = await xeroGet(tokens, "/Invoices", { IDs: chunk.map(d => (d.config as any).xeroInvoiceId).join(","), summaryOnly: "true" } as any);
    const byId = new Map((r.Invoices || []).map((x: any) => [x.InvoiceID, x]));
    for (const d of chunk) {
      const c: any = d.config;
      const live: any = byId.get(c.xeroInvoiceId);
      if (!live) continue;
      const sub = R(Number(live.SubTotal) || 0), tax = R(Number(live.TotalTax) || 0), tot = R(Number(live.Total) || 0);
      if (Math.abs((c.subTotal || 0) - sub) < 0.005 && Math.abs((c.gstAmount || 0) - tax) < 0.005) continue;
      const di: any = c.documentInfo || {};
      await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, subTotal: sub, gstAmount: tax, nettTotal: tot, xeroGross: tot, documentInfo: { ...di, subTotal: sub, gstAmount: tax } } } });
      console.log(`  ${d.name}: ${c.subTotal}/${c.gstAmount} → ${sub}/${tax} (her edit)`);
      updated++;
    }
  }
  console.log(`trued ${updated} drafts to Xero figures`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
