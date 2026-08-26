import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const q: any = await xeroGet(tokens, "/Invoices", { where: `Contact.Name.Contains("Sunpower")` });
  for (const inv of q.Invoices || []) {
    const ms = /\/Date\((\d+)/.exec(inv.UpdatedDateUTC)?.[1];
    console.log(`${inv.InvoiceNumber} [${inv.Status}] $${inv.Total} due=$${inv.AmountDue} · date=${inv.DateString?.slice(0, 10)} · updated=${ms ? new Date(Number(ms)).toISOString().slice(0, 16) : "?"}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
