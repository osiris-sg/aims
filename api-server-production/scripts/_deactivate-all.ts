// All templates start INACTIVE — the accountant activates each one as she
// approves it in tomorrow's walkthrough (guru 2026-08-27).
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const r = await prisma.recurringInvoiceTemplate.updateMany({ where: { organizationId: ORG, isActive: true }, data: { isActive: false } });
  const total = await prisma.recurringInvoiceTemplate.count({ where: { organizationId: ORG } });
  const active = await prisma.recurringInvoiceTemplate.count({ where: { organizationId: ORG, isActive: true } });
  console.log(`deactivated ${r.count}; now ${active} active / ${total} total`);
  process.exit(0);
})();
