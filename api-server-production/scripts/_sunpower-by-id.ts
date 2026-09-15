import { createScriptPrisma, getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, config: true } });
  const sun = docs.filter(d => /sunpower/i.test(JSON.stringify(d.config)) && (d.config as any).xeroInvoiceId);
  const ids = [...new Set(sun.map(d => (d.config as any).xeroInvoiceId))];
  console.log("AIMS docs w/ Sunpower + xeroId:", sun.map(d => d.name).join(", "), "→", ids.length, "id(s)");
  const tokens = await getXeroTokens(null as any, ORG);
  for (const id of ids) {
    const r: any = await xeroGet(tokens, "/Invoices", { IDs: id } as any).catch(() => null);
    for (const i of r?.Invoices || []) console.log(`  ${i.InvoiceNumber} [${i.Status}] $${i.Total} due=$${i.AmountDue} date=${i.DateString?.slice(0, 10)} contact="${i.Contact?.Name}"`);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
