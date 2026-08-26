// Untangle MG20260130: pull every invoice mentioning it, full line text.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const hits: any[] = [];
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { where: `Type=="ACCREC"&&Date>=DateTime(2026,6,1)`, page: String(page) });
    const invs = r.Invoices || [];
    for (const inv of invs) {
      if (["VOIDED", "DELETED"].includes(inv.Status)) continue;
      const txt = (inv.LineItems || []).map((l: any) => l.Description || "").join("\n");
      if (/MG20260130/i.test(txt)) hits.push({ inv, txt });
    }
    if (invs.length < 100) break;
  }
  for (const { inv, txt } of hits) {
    console.log(`\n═══════ ${inv.InvoiceNumber} [${inv.Status}] $${inv.Total} · ${inv.Contact?.Name} · date=${inv.DateString?.slice(0, 10)} ref="${(inv.Reference || "").slice(0, 90)}"`);
    console.log(txt.split("\n").filter((l: string) => l.trim()).map((l: string) => "   " + l.slice(0, 110)).join("\n"));
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
