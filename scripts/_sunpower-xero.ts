import { getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const r: any = await xeroGet(tokens, "/Invoices", { where: 'Contact.Name.Contains("Sunpower")' } as any);
  for (const i of r.Invoices || []) console.log(`${i.InvoiceNumber} [${i.Status}] $${i.Total} due=$${i.AmountDue} date=${i.DateString?.slice(0, 10)} dueDate=${i.DueDateString?.slice(0, 10)} ref=${(i.Reference || "").slice(0, 70)}`);
  if (!(r.Invoices || []).length) console.log("none");
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
