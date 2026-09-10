import { getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  // 1) find every contact whose name resembles jia yi (case-insensitive, local filter)
  const contacts: any[] = [];
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Contacts", { page: String(page) } as any);
    contacts.push(...(r.Contacts || []));
    if ((r.Contacts || []).length < 100) break;
  }
  const hits = contacts.filter(c => /jia\s*yi|jiayi/i.test(c.Name || ""));
  console.log(`contacts matching: ${hits.map(h => `"${h.Name}" (${h.ContactID.slice(0, 8)})`).join(" · ") || "NONE"}`);
  // 2) all invoices + credit notes for those contacts, ever
  for (const h of hits) {
    const inv: any = await xeroGet(tokens, "/Invoices", { ContactIDs: h.ContactID } as any);
    for (const i of inv.Invoices || []) console.log(`  INV ${i.InvoiceNumber} [${i.Status}] ${i.Type} $${i.Total} date=${i.DateString?.slice(0, 10)}`);
    if (!(inv.Invoices || []).length) console.log(`  "${h.Name}": no invoices at all`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
