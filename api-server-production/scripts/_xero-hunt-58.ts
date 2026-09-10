// Search Xero LIVE line items of every invoice dated >= 2026-07-15 for the
// Bukit Panjang set (MG20250058 / DO202607-015 / Bukit Panjang), any contact.
import { getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const summaries: any[] = [];
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { page: String(page), where: 'Date >= DateTime(2026,07,15)' } as any);
    summaries.push(...(r.Invoices || []));
    if ((r.Invoices || []).length < 100) break;
  }
  console.log(`invoices since 15 Jul in Xero: ${summaries.length} — fetching line items…`);
  const ids = summaries.map(s => s.InvoiceID);
  let hits = 0;
  for (let i = 0; i < ids.length; i += 40) {
    const r: any = await xeroGet(tokens, "/Invoices", { IDs: ids.slice(i, i + 40).join(",") } as any);
    for (const inv of r.Invoices || []) {
      const blob = (inv.LineItems || []).map((l: any) => l.Description || "").join("\n") + " " + (inv.Reference || "");
      if (/MG20250058|202607-015|Bukit\s*Panjang/i.test(blob)) {
        hits++;
        console.log(`HIT ${inv.InvoiceNumber} [${inv.Status}] $${inv.Total} date=${inv.DateString?.slice(0, 10)} contact="${inv.Contact?.Name}"`);
        for (const l of inv.LineItems || []) if (/MG20250058|Bukit|202607-015/i.test(l.Description || "")) console.log("   " + String(l.Description).split("\n").filter((x: string) => /MG20250058|Bukit|202607-015|mth/i.test(x)).join(" ¶ ").slice(0, 110));
      }
    }
  }
  console.log(`\n${hits} Xero invoices since 15 Jul mention the Bukit Panjang set`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
