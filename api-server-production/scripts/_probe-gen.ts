import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const recent = await prisma.document.findMany({ where: { organizationId: ORG, createdAt: { gte: new Date(Date.now() - 40 * 60000) } }, select: { name: true, type: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 15 });
  console.log("docs created in last 40 min:", recent.length);
  for (const d of recent) console.log(` ${d.createdAt.toISOString().slice(11, 16)} ${d.name} [${d.type}]`);
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { code: true, isActive: true, nextRunDate: true, lastRunAt: true, lastRunDocumentId: true }, orderBy: { code: "asc" }, take: 5 });
  for (const t of tpls) console.log(`${t.code} active=${t.isActive} nextRun=${t.nextRunDate.toISOString().slice(0, 10)} lastRunAt=${t.lastRunAt?.toISOString() || "never"}`);
  process.exit(0);
})();
