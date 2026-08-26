// Keep the richer UPLOADED DOs as the real records: convert type DO →
// DELIVERY_ORDER (+status/date/customer), delete my leaner backfill dup.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  // 1) DO202608-001: uploaded (Sunpower) wins; delete backfill twin
  const up = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DO", name: "DO202608-001" } });
  const mine = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-001" } });
  if (up && mine) {
    const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "Sunpower" } }, select: { id: true, name: true } });
    await prisma.document.delete({ where: { id: mine.id } });
    const c: any = up.config;
    await prisma.document.update({ where: { id: up.id }, data: { type: "DELIVERY_ORDER", status: "delivered_installed" as any, config: { ...c, date: c.date || "2026-08-03", customerId: cust?.id, customerName: cust?.name, deliveryTo: c.deliveryTo || "Neo Tiew Harvest Link", remarks: (c.remarks || "") + " | uploaded scan is source of truth; invoiced BI202608035 (since edited by accountant)" } } });
    console.log("✓ DO202608-001: uploaded doc promoted to DELIVERY_ORDER, backfill twin deleted");
  }
  // 2) DO202606-007 (June, SCB AIS pair — the chain of BI202608077): promote type only
  const jun = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DO", name: "DO202606-007" } });
  if (jun) {
    const c: any = jun.config;
    const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "SCB Building" } }, select: { id: true, name: true } });
    await prisma.document.update({ where: { id: jun.id }, data: { type: "DELIVERY_ORDER", status: "delivered_installed" as any, config: { ...c, customerId: c.customerId || cust?.id, customerName: c.customerName || cust?.name, remarks: (c.remarks || "") + " | uploaded scan; AIS chain of BI202608077 (note: AIS2026038 exchanged out on DO202608-010, 14.08)" } } });
    console.log("✓ DO202606-007 promoted to DELIVERY_ORDER (SCB June AIS delivery)");
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
