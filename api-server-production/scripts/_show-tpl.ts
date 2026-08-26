import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-005" } });
  const c: any = t!.config;
  console.log(`${t!.code} · ${t!.name} · nextRunNo=${t!.nextRunNo} · active=${t!.isActive}`);
  console.log(`ref: ${c.reference}`);
  console.log(`billTo: ${(c.billTo || "").split("\n").join(" / ")}`);
  console.log(`totals: ${c.subTotal} + ${c.gstAmount} = ${c.nettTotal} · taxCode=${c.documentInfo?.taxCode}`);
  for (const it of c.items || []) console.log(` [${(it.itemCode || "—").padEnd(9)}] qty=${JSON.stringify(it.quantity)} amt=${JSON.stringify(it.amount)} acct=${it.accountCode || "—"} :: ${(it.description || "").replace(/\n/g, " ¶ ").slice(0, 85)}`);
  process.exit(0);
})();
