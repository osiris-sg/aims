// Distinct LION units rented in August: parse model+serial pairs from ALL
// Aug rental invoices in Xero (client's + ours).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const RENTAL = /rental|rent of|hire|lease/i;
  const DISP = /disposal|soil|tonne|wharfage|pass application|scrap/i;
  const units = new Map<string, { model: string; invoices: string[]; cust: string }>();
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { where: `Type=="ACCREC"&&Date>=DateTime(2026,8,1)`, page: String(page) });
    const invs = r.Invoices || [];
    for (const inv of invs) {
      if (["VOIDED", "DELETED"].includes(inv.Status)) continue;
      const txt = (inv.LineItems || []).map((l: any) => l.Description || "").join("\n");
      if (!RENTAL.test(txt) || DISP.test(txt)) continue;
      // walk text: track last-seen LION model; pair with following S/No
      const re = /(LION\s?(\d+))|S\/No\.?:?\s*(MG\w+)/gi;
      let m: RegExpExecArray | null, lastModel = "";
      while ((m = re.exec(txt))) {
        if (m[2]) lastModel = `LION${m[2]}`;
        else if (m[3] && lastModel) {
          const s = m[3].toUpperCase();
          const u = units.get(s) || { model: lastModel, invoices: [], cust: inv.Contact?.Name || "" };
          u.invoices.push(inv.InvoiceNumber);
          units.set(s, u);
        }
      }
    }
    if (invs.length < 100) break;
  }
  const byModel: Record<string, string[]> = {};
  for (const [s, u] of units) (byModel[u.model] = byModel[u.model] || []).push(s);
  let total = 0;
  for (const [model, serials] of Object.entries(byModel).sort()) {
    total += serials.length;
    console.log(`${model}: ${serials.length} units`);
    console.log(`   ${serials.sort().join(", ")}`);
  }
  console.log(`\nTOTAL distinct LION units on rent (invoiced Aug): ${total}`);
  const multi = [...units].filter(([, u]) => new Set(u.invoices).size > 1);
  if (multi.length) { console.log(`\nunits on >1 invoice:`); for (const [s, u] of multi) console.log(`  ${s} (${u.model}): ${[...new Set(u.invoices)].join(", ")}`); }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
