import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const name of ["BI202608046", "BI202608055"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name, config: { path: ["xeroSyncedBy"], equals: "app2-recurring-push" } } });
    const c: any = d!.config;
    const sub = (c.items || []).reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
    const gst = Math.round((c.items || []).reduce((s: number, it: any) => s + (Number(it.amount) || 0) * ((Number(it.tax) || 0) / 100), 0) * 100) / 100;
    await prisma.document.update({ where: { id: d!.id }, data: { status: "draft" as any, config: { ...c, subTotal: sub, gstAmount: gst, nettTotal: Math.round((sub + gst) * 100) / 100, accountantNote: "Xero copy emptied/renamed by accountant (not to be issued) — kept original amounts in AIMS for history", documentInfo: { ...(c.documentInfo || {}), subTotal: sub, gstAmount: gst } } } });
    console.log(`✓ ${name}: totals restored from items ($${sub}), status=draft, flagged`);
  }
  process.exit(0);
})();
