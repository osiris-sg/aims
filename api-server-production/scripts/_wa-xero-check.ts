import { getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  for (const name of ["Prime Builders", "Integrate", "Tanglin", "Woh Hup", "QJI", "Jiayi", "Jia Yi", "Kim Heng", "Tenda", "Shuan Huat", "Lian Beng"]) {
    const r: any = await xeroGet(tokens, "/Invoices", { where: `Contact.Name.Contains("${name}")`, ModifiedAfter: undefined } as any);
    const invs = (r.Invoices || []).filter((i: any) => i.DateString >= "2026-08-01");
    if (!invs.length) { console.log(`${name.padEnd(16)} — nothing in Xero since 1 Aug`); continue; }
    for (const i of invs) console.log(`${name.padEnd(16)} ${i.InvoiceNumber} [${i.Status}] $${i.Total} date=${i.DateString?.slice(0, 10)}`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
