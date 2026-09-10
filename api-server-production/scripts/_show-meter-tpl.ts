import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-031" } });
  console.log(`${t!.code} · ${t!.name} · nextRunNo=${t!.nextRunNo} lastRunDoc=${t!.lastRunDocumentId?.slice(0, 8)}`);
  for (const it of ((t!.config as any).items || [])) console.log(`TPL qty=${JSON.stringify(it.quantity)} up=${JSON.stringify(it.unitPrice)} amt=${JSON.stringify(it.amount)} acct=${it.accountCode}\n  ` + String(it.description || "").split("\n").join("\n  "));
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202609031" } });
  const c: any = d!.config;
  console.log(`\nDRAFT BI202609031 [${d!.status}] sub=${c.subTotal} gst=${c.gstAmount} nett=${c.nettTotal}`);
  for (const it of c.items || []) console.log(`DOC qty=${JSON.stringify(it.quantity)} up=${JSON.stringify(it.unitPrice)} amt=${JSON.stringify(it.amount)}\n  ` + String(it.description || "").split("\n").join("\n  "));
  process.exit(0);
})();
