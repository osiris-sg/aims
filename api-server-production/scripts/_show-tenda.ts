import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-078" } });
  const c: any = t!.config;
  console.log(`${t!.code} · ${t!.name} · cust=${t!.customerId.slice(0, 8)}`);
  console.log("ref:", c.reference, "\nbillTo:", JSON.stringify(c.billTo));
  for (const it of c.items || []) console.log(`ITEM qty=${it.quantity} up=${it.unitPrice} amt=${it.amount} code=${it.itemCode} acct=${it.accountCode}\n  ` + String(it.description || "").split("\n").join("\n  "));
  process.exit(0);
})();
