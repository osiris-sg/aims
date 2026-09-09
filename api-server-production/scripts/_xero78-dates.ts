import { getXeroTokens, xeroGet, createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const r: any = await xeroGet(tokens, "/Invoices", { InvoiceNumbers: "BI202608078" } as any);
  for (const inv of r.Invoices || []) {
    console.log(inv.InvoiceNumber, inv.Status);
    for (const li of inv.LineItems || []) for (const l of String(li.Description || "").split("\n")) if (/dated/i.test(l)) console.log("  " + l.trim());
  }
  process.exit(0);
})();
