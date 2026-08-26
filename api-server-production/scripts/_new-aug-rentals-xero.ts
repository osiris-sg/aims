// Find NEW August rentals in Xero (client-issued invoices we don't cover):
// AR invoices dated Aug 2026 that look like rentals, esp. 1st-month/new
// deployments, vs our 71 recurring drafts + known chains.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const RENTAL = /rental|rent of|hire|lease/i;
  const DISP = /disposal|soil|tonne|wharfage|pass application|scrap/i;
  const rows: any[] = [];
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { where: `Type=="ACCREC"&&Date>=DateTime(2026,8,1)`, page: String(page) });
    const invs = r.Invoices || [];
    for (const inv of invs) {
      if (["VOIDED", "DELETED"].includes(inv.Status)) continue;
      const txt = (inv.LineItems || []).map((l: any) => l.Description || "").join("\n");
      if (!RENTAL.test(txt) || DISP.test(txt)) continue;
      rows.push({ num: inv.InvoiceNumber, id: inv.InvoiceID, cust: inv.Contact?.Name, total: inv.Total, status: inv.Status, date: inv.DateString?.slice(0, 10), txt });
    }
    if (invs.length < 100) break;
  }
  // which are OURS (linked in AIMS) vs client-new?
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, config: true } });
  const linkedIds = new Set(docs.map(d => (d.config as any)?.xeroInvoiceId).filter(Boolean));
  const news = rows.filter(r => !linkedIds.has(r.id));
  console.log(`${rows.length} Aug rental invoices in Xero; ${news.length} NOT linked to AIMS docs (client-made):`);
  for (const n of news) {
    const first = /1st\s*(mth|month)|pro-?rat/i.test(n.txt) ? " ★NEW-DEPLOYMENT" : "";
    const serial = /S\/No\.?:?\s*([A-Z0-9]+)/i.exec(n.txt)?.[1] || "";
    console.log(`  ${n.num} [${n.status}] $${n.total} · ${n.cust?.slice(0, 34)} · ${n.date} · ${serial}${first}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
