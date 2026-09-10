import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG } });
  const t = tpls.find(x => /SIDS/i.test(JSON.stringify(x.config)) && /SCB/i.test(x.name));
  console.log(`${t!.code} · ${t!.name} · customerId=${t!.customerId.slice(0, 8)} · $${(t!.config as any).nettTotal}`);
  const c: any = t!.config;
  console.log("ref:", c.reference);
  console.log("billTo:", JSON.stringify(c.billTo));
  for (const it of c.items || []) console.log(`ITEM qty=${it.quantity} up=${it.unitPrice} amt=${it.amount} code=${it.itemCode} acct=${it.accountCode} tax=${it.tax}\n  ` + String(it.description || "").split("\n").join("\n  "));
  process.exit(0);
})();
