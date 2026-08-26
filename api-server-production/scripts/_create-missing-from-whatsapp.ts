// Missing Aug deliveries/returns per Arun's WhatsApp log (2026-08-27):
// CNQC pumps 20/8, Prime Builders AF5 20/8, CCG LION250 22/8, Woh Hup LION500
// 25/8, Rong Send collection 16/8. Plus enrichments to existing docs.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const TPL = "b4898f54-fec8-46dd-a3be-52fc47e34c05";
const NEW = [
  { name: "DO202608-014", type: "DELIVERY_ORDER", date: "2026-08-20", cust: "Qingjian", items: [{ description: "2x Submersible Water Pump (per Arun 20/8 — model TBC; likely PO SP-PO2608109 2x KBZ45.5, SALES)" }], to: "CNQC site (TBC)", note: "From Arun's delivery log 20/8. Folder PO 20260819 SP-PO2608109 = SALES of 2x KBZ45.5 pumps — probably this delivery. Number 014 date-fitted, confirm vs paper book." },
  { name: "DO202608-017", type: "DELIVERY_ORDER", date: "2026-08-20", cust: "Prime", items: [{ description: "1x AF-5 System" }], to: "TBC", note: "From Arun's log 20/8 (Prime Builders). Folder has PO 20260813 'Prime Bldrs PO No. 064 OD BI PO-01'. ⚠ check billing. Provisional number." },
  { name: "DO202608-018", type: "DELIVERY_ORDER", date: "2026-08-22", cust: "China Construction (South Pacific)", items: [{ description: "1x Micro-Grid System LION250\n1x 60ES Diesel Generator\n1x 10m 25mm cable" }], to: "T5 site", note: "From Arun's log 22/8 ('CCG', Location T5). ⚠ NOT INVOICED — new rental. Customer guess CCSP (T5) — confirm. Provisional number." },
  { name: "DO202608-019", type: "DELIVERY_ORDER", date: "2026-08-25", cust: "Woh Hup", items: [{ description: "1x Micro-Grid System LION500" }], to: "18 Holland Drive", note: "From Arun's log 25/8. ⚠ NOT INVOICED — new rental. Provisional number." },
  { name: "RTN-DO202608-002", type: "RETURN_DELIVERY_ORDER", date: "2026-08-16", cust: "Rong Send", items: [{ description: "Collection (unit TBC) — per Arun 15/8: 'Tomorrow collection 16/8 Rong Send Construction & Interior'" }], to: "TBC", note: "From Arun's log. Customer + unit to confirm; no signed RTN in folder yet." },
];
(async () => {
  for (const d of NEW) {
    const exists = await prisma.document.findFirst({ where: { organizationId: ORG, name: d.name } });
    if (exists) { console.log(`= ${d.name} exists`); continue; }
    const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: d.cust, mode: "insensitive" } }, select: { id: true, name: true } });
    await prisma.document.create({ data: { organizationId: ORG, type: d.type, name: d.name, status: "delivered_installed" as any, documentTemplateId: TPL, config: { date: d.date, customerId: cust?.id || "", customerName: cust?.name || d.cust + " (confirm)", deliveryTo: d.to, items: d.items.map((it: any) => ({ quantity: 1, deploymentType: "RENTAL", ...it })), referenceNo: d.note.split(".")[0], documentInfo: { referenceNo: d.note.split(".")[0] }, remarks: d.note, createdBy: "whatsapp-log backfill 2026-08-27" } } });
    console.log(`✓ ${d.name} · ${cust?.name || d.cust}`);
  }
  // enrichments
  const rtn1 = await prisma.document.findFirst({ where: { organizationId: ORG, name: "RTN-DO202608-001" } });
  if (rtn1) { const c: any = rtn1.config; await prisma.document.update({ where: { id: rtn1.id }, data: { config: { ...c, items: [{ quantity: 1, description: "Collection of 1x LION135 (per Arun's log 14/8 1:20pm)" }], remarks: (c.remarks || "") + " | Arun 14/8: 'Return delivery 1 unit Lion 135' — the collected unit is a LION135 (delivery same day DO-009 was the LION375)." } } }); console.log("✓ RTN-001 clarified: collected unit = LION135"); }
  const d2 = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-002" } });
  if (d2) { const c: any = d2.config; await prisma.document.update({ where: { id: d2.id }, data: { config: { ...c, date: "2026-08-03", items: [{ quantity: 2, deploymentType: "RENTAL", description: "2x AF-40 (40m³) Systems (per Arun 3/8)" }], remarks: (c.remarks || "") + " | Arun 3/8: 2x AF 40m³ delivered Clementi Ave 1." } } }); console.log("✓ DO-002 corrected: 2x AF-40, delivered 3/8"); }
  const d13 = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-013" } });
  if (d13) { const c: any = d13.config; await prisma.document.update({ where: { id: d13.id }, data: { config: { ...c, remarks: (c.remarks || "") + " | ⚠ Arun logged Integrate BESS deliveries BOTH 18/8 AND 20/8 (same text) — possibly TWO units at Joo Koon; confirm (2nd would take a gap number e.g. 011)." } } }); console.log("✓ DO-013 flagged: possibly 2 Integrate units (18/8 + 20/8)"); }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
