import { getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const contacts: any[] = [];
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Contacts", { page: String(page) } as any);
    contacts.push(...(r.Contacts || []));
    if ((r.Contacts || []).length < 100) break;
  }
  const hits = contacts.filter(c => /sun\s*power/i.test(c.Name || ""));
  console.log("contacts:", hits.map(h => `"${h.Name}"`).join(" · ") || "NONE");
  for (const h of hits) {
    const inv: any = await xeroGet(tokens, "/Invoices", { ContactIDs: h.ContactID } as any);
    for (const i of inv.Invoices || []) console.log(`  ${i.InvoiceNumber} [${i.Status}] $${i.Total} due=$${i.AmountDue} date=${i.DateString?.slice(0, 10)}`);
    if (!(inv.Invoices || []).length) console.log("  (no invoices)");
  }
  // also: any invoice whose number mentions Sunpower
  const r2: any = await xeroGet(tokens, "/Invoices", { where: 'InvoiceNumber.Contains("Sunpower")' } as any);
  console.log("by number:", (r2.Invoices || []).map((i: any) => `${i.InvoiceNumber} [${i.Status}] $${i.Total}`).join(" · ") || "none");
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
