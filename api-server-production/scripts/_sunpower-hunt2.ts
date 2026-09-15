import { createScriptPrisma, getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  // any Xero invoice since 1 Aug whose lines mention the Sunpower kit/site
  const summaries: any[] = [];
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { page: String(page), where: 'Date >= DateTime(2026,08,01)' } as any);
    summaries.push(...(r.Invoices || []));
    if ((r.Invoices || []).length < 100) break;
  }
  const ids = summaries.map(s => s.InvoiceID);
  let hits = 0;
  for (let i = 0; i < ids.length; i += 40) {
    const r: any = await xeroGet(tokens, "/Invoices", { IDs: ids.slice(i, i + 40).join(",") } as any);
    for (const inv of r.Invoices || []) {
      const blob = (inv.LineItems || []).map((l: any) => l.Description || "").join("\n") + " " + (inv.Reference || "");
      if (/MG20260159|Neo Tiew|Sunpower/i.test(blob)) { hits++; console.log(`HIT ${inv.InvoiceNumber} [${inv.Status}] $${inv.Total} contact="${inv.Contact?.Name}"`); }
    }
  }
  console.log(hits ? "" : "NO Sunpower re-creation in Xero since 1 Aug — August is unbilled there");
  // unlink the AIMS mirror so ID-based sync can't cross-contaminate
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: "BI202608xxxxSunpower" } });
  if (d) {
    const c: any = d.config;
    const { xeroInvoiceId, xeroStatus, xeroBalance, xeroGross, xeroAmountPaid, ...rest } = c;
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...rest, remarks: ((c.remarks || "") + " | 15/09: Xero shell was recycled into BI202608127 (Rich Construction) by accountant — link severed; Sunpower Aug $6,322 must be re-raised in Xero.").replace(/^ \| /, "") } } });
    console.log("✓ AIMS mirror unlinked from the recycled Xero invoice");
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
