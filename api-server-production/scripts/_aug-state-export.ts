// Live August rental state: every Aug rental invoice in Xero + AIMS mapping.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const RENTAL = /rental|rent of|hire|lease/i;
  const DISP = /disposal|soil|tonne|wharfage|pass application|scrap/i;
  const rows: any[] = [];
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { where: `Type=="ACCREC"&&Date>=DateTime(2026,8,1)&&Date<DateTime(2026,9,1)`, page: String(page) });
    const invs = r.Invoices || [];
    for (const inv of invs) {
      if (["VOIDED", "DELETED"].includes(inv.Status)) continue;
      const txt = (inv.LineItems || []).map((l: any) => l.Description || "").join("\n");
      if (!RENTAL.test(txt) || DISP.test(txt)) continue;
      const ordinal = /\(?(\d+)(st|nd|rd|th)\s*(mth|month)\)?/i.exec(txt);
      const serials = [...txt.matchAll(/S\/No\.?:?\s*((?:MG|AF|MDB|AIS)\w+[\w-]*)/gi)].map(m => m[1].toUpperCase());
      const doRef = /DO[\/\s]?(?:No\.?:?\s*)?([A-Z]*\d{4,6}[-\/]\d{2,4}[A-Za-z0-9-]*)/i.exec(inv.Reference || txt)?.[1] || "";
      const prorate = /pro-?rat/i.test(txt);
      rows.push({
        xeroNum: inv.InvoiceNumber, xeroId: inv.InvoiceID, status: inv.Status,
        cust: inv.Contact?.Name || "", total: Number(inv.Total) || 0, net: Number(inv.SubTotal) || 0,
        date: inv.DateString?.slice(0, 10), ref: inv.Reference || "",
        ordinal: ordinal ? parseInt(ordinal[1], 10) : null, serials: [...new Set(serials)], doRef, prorate,
      });
    }
    if (invs.length < 100) break;
  }
  // AIMS mapping by xeroInvoiceId
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, status: true, config: true } });
  const byId = new Map(docs.map(d => [(d.config as any)?.xeroInvoiceId, d]).filter(([k]) => k));
  for (const r of rows) {
    const d: any = byId.get(r.xeroId);
    r.aimsName = d?.name || "";
    r.aimsStatus = d?.status || "";
  }
  fs.writeFileSync("scripts/_aug-state.json", JSON.stringify(rows, null, 1));
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log(`${rows.length} Aug rental invoices:`, JSON.stringify(byStatus));
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
