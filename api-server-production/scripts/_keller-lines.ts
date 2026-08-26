import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const q: any = await xeroGet(tokens, "/Invoices", { where: `InvoiceNumber=="BI202608034"` });
  const inv = q.Invoices?.[0];
  console.log((inv?.LineItems || []).map((l: any) => l.Description).join("\n---\n"));
  process.exit(0);
})();
