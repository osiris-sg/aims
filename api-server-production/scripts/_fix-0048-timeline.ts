// DO202609-0048 timeline correction (guru 2026-09-15): the 13/09 03:09
// timestamps were guru back-entering the run via the app; actual delivery
// was 05/09/2026 3:00pm SGT. Rewrites run, item, and report timestamps.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const T = new Date("2026-09-05T15:00:00+08:00");
const T_END = new Date("2026-09-05T15:10:00+08:00");
(async () => {
  const doc = await prisma.document.findFirst({ where: { organizationId: ORG, name: "DO202609-0048" }, select: { id: true } });
  const items = await (prisma as any).deliveryItem.findMany({ where: { documentId: doc!.id } });
  if (!items.length) { console.log("no delivery items linked"); process.exit(1); }
  const deliveryId = items[0].deliveryId;
  for (const it of items) {
    await (prisma as any).deliveryItem.update({ where: { id: it.id }, data: {
      ...(it.deliveringAt ? { deliveringAt: T } : {}),
      ...(it.deliveredAt ? { deliveredAt: T_END } : {}),
      ...(it.completedAt ? { completedAt: T_END } : {}),
    } });
  }
  await (prisma as any).delivery.update({ where: { id: deliveryId }, data: { startedAt: T, completedAt: T_END } });
  const reports = await (prisma as any).maintenanceServiceReport.findMany({ where: { OR: [{ documentId: doc!.id }, { deliveryId }] } }).catch(() => []);
  for (const r of reports) {
    const data: any = { createdAt: r.kind === "DO_ACK" ? T_END : T };
    if (r.signedAt) data.signedAt = T_END;
    if (r.serviceData && typeof r.serviceData === "object" && (r.serviceData as any).signedDateText) {
      data.serviceData = { ...(r.serviceData as any), signedDateText: "05/09/2026" };
    }
    await (prisma as any).maintenanceServiceReport.update({ where: { id: r.id }, data });
    console.log(`report ${r.kind} → ${r.kind === "DO_ACK" ? "15:10" : "15:00"} 05/09`);
  }
  console.log(`✓ run + ${items.length} item(s) + ${reports.length} report(s) re-timed to 05/09/2026 3pm`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
