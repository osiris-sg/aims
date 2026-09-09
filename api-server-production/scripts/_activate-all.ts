import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const r = await prisma.recurringInvoiceTemplate.updateMany({ where: { organizationId: ORG, isActive: false }, data: { isActive: true } });
  const due = await prisma.recurringInvoiceTemplate.count({ where: { organizationId: ORG, isActive: true, nextRunDate: { lte: new Date() } } });
  console.log(`activated ${r.count}; ${due} due — the 2-min cron on the deployed API will generate them`);
  process.exit(0);
})();
