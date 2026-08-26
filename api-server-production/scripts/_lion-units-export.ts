// LION fleet export: every unit × its August invoice(s), from ALL Xero Aug
// rental invoices, JSON for the Excel builder.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
import * as fs from "fs";
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
      const re = /(LION\s?(\d+))|S\/No\.?:?\s*(MG\w+)/gi;
      let m: RegExpExecArray | null, lastModel = "";
      const seen = new Set<string>();
      while ((m = re.exec(txt))) {
        if (m[2]) lastModel = `LION${m[2]}`;
        else if (m[3] && lastModel && !seen.has(m[3].toUpperCase())) {
          seen.add(m[3].toUpperCase());
          rows.push({
            serial: m[3].toUpperCase(), model: lastModel,
            customer: inv.Contact?.Name || "?", invoice: inv.InvoiceNumber,
            reference: inv.Reference || "", status: inv.Status,
            total: Number(inv.Total) || 0, date: inv.DateString?.slice(0, 10),
          });
        }
      }
    }
    if (invs.length < 100) break;
  }
  // Amoy Quee correction: MG20260130 on the KTC chain is actually a LION135 (invoice's own remark)
  for (const r2 of rows) if (r2.serial === "MG20260130" && /KTC/i.test(r2.customer)) { r2.model = "LION135"; r2.note = "serial stale on invoice — actual unit is LION135 (per invoice REMARKS)"; }
  fs.writeFileSync("scripts/_lion-units.json", JSON.stringify(rows, null, 1));
  console.log(`exported ${rows.length} unit-invoice rows`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
