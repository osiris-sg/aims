import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const r: any = await xeroGet(tokens, "/Invoices", { where: `Type=="ACCREC"`, InvoiceNumbers: "BI202608047,BI202608062,BI202608079,BI202608050" } as any);
  // xeroGet may not support InvoiceNumbers param — fallback query each
  for (const num of ["BI202608047", "BI202608062", "BI202608079", "BI202608050"]) {
    const q: any = await xeroGet(tokens, "/Invoices", { where: `InvoiceNumber=="${num}"` });
    for (const inv of q.Invoices || []) {
      const ms = /\/Date\((\d+)/.exec(inv.UpdatedDateUTC)?.[1];
      console.log(`${num}: [${inv.Status}] $${inv.Total} · ${inv.Contact?.Name?.slice(0, 30)} · date=${inv.DateString?.slice(0, 10)} · updated=${ms ? new Date(Number(ms)).toISOString().slice(0, 16) : "?"} · id=${inv.InvoiceID.slice(0, 8)}`);
      const aims = await prisma.document.findFirst({ where: { organizationId: ORG, config: { path: ["xeroInvoiceId"], equals: inv.InvoiceID } }, select: { name: true, status: true } });
      console.log(`   AIMS mirror: ${aims ? `${aims.name} [${aims.status}]` : "NONE"}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
