import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  // delete the TZ-bug stray
  const stray = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202608035", createdAt: { gte: new Date("2026-09-03") } } });
  if (stray) { await prisma.document.delete({ where: { id: stray.id } }); console.log("✓ deleted stray BI202608035 (cron TZ bug, wrong month)"); }
  // rewind REC-035 to due state
  const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, code: "REC-035" } });
  await prisma.recurringInvoiceTemplate.update({ where: { id: t!.id }, data: { nextRunDate: new Date("2026-09-01T00:00:00+08:00"), nextRunNo: (t!.nextRunNo ?? 14) - 1, lastRunAt: null, lastRunDocumentId: null } });
  console.log(`✓ REC-035 rewound (nextRunNo → ${(t!.nextRunNo ?? 14) - 1})`);
  process.exit(0);
})();
