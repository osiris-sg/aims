// Create AIMS DELIVERY_ORDER docs for August deliveries evidenced by invoice
// refs + PO folder but absent from AIMS. Client-book numbers kept verbatim.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const TPL = "b4898f54-fec8-46dd-a3be-52fc47e34c05";
const DOS = [
  { name: "DO202608-001", date: "2026-08-03", cust: "Sunpower Grand Holdings", items: [{ description: "1x Micro-Grid System LION135\nS/No.: MG20260159", serialNumbers: ["MG20260159"] }, { description: "1x Diesel Generator (per quotation)" }], to: "Neo Tiew Harvest Link", note: "From invoice BI202608035 ref (1st mth + deposit). Xero invoice since edited/renamed by accountant." },
  { name: "DO202608-002", date: "2026-08-01", cust: "China Construction Realty", items: [{ description: "AF-40 / AF-100 units per invoice BI202608021 (16th/1st mth combined, Clementi Ave 1)" }], to: "Clementi Ave 1 LP10", note: "Exchange/additional units — see BI202608021 ref (DO202504-006, DO202602-001 + DO202608-002)." },
  { name: "DO202608-003", date: "2026-08-05", cust: "Nishio Rent All", items: [{ description: "1x Micro-Grid System LION500" }], to: "per Nishio order", note: "⚠ Rental ABORTED: invoice was zeroed + renamed 'RETURN' by accountant — unit returned shortly after delivery. Return DO not yet recorded." },
  { name: "DO202608-004", date: "2026-08-05", cust: "SCB Building Construction", items: [{ description: "2x AIS units\nS/No.: AIS2026027, AIS2026048", serialNumbers: ["AIS2026027", "AIS2026048"] }], to: "Opp Blk 280 Tampines St 22", note: "PO SCB-PO-2608-16781 (05.08). Invoiced BI202608078 1st mth pro-rated." },
  { name: "DO202608-007", date: "2026-08-08", cust: "Debenho", items: [{ description: "1x Micro-Grid System LION375\nS/No.: MG20260124\n1x Diesel Generator + cable", serialNumbers: ["MG20260124"] }], to: "HDB Yishun N5C11", note: "PO DEB_Y_26_08_14074. Invoiced BI202608030." },
  { name: "DO202608-008", date: "2026-08-11", cust: "Debenho", items: [{ description: "1x Micro-Grid System LION375\nS/No.: MG20250054\n1x Diesel Generator + cable", serialNumbers: ["MG20250054"] }], to: "HDB Yishun N5C11", note: "PO DEB_Y_26_08_14075. Invoiced BI202608031." },
  { name: "DO202608-012", date: "2026-08-18", cust: "Debenho", items: [{ description: "1x Micro-Grid System LION375\nS/No.: TBC (invoice shows MG20260121 — duplicate of BI202608028's unit; confirm real serial)\n1x Diesel Generator + cable" }], to: "HDB Yishun N5C11", note: "PO DEB_Y_26_08_14076. Invoiced BI202608032. ⚠ serial on invoice duplicated — needs correction." },
  { name: "DO202608-0042", date: "2026-08-08", cust: "QJI-GCC", items: [{ description: "1x Micro-Grid System LION375 (BESS 375 kWh)" }], to: "Lentor Gardens", note: "⚠ PO dated 23.07 (delivery 08.08) — NOT YET INVOICED. Client paper-DO number unknown (one of 005/006/009-011?)." },
];
(async () => {
  const created: string[] = [];
  for (const d of DOS) {
    const exists = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: d.name } });
    if (exists) { console.log(`= ${d.name} exists — skipped`); continue; }
    const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: d.cust, mode: "insensitive" } }, select: { id: true, name: true } });
    await prisma.document.create({ data: {
      organizationId: ORG, type: "DELIVERY_ORDER", name: d.name, status: "delivered_installed" as any, documentTemplateId: TPL,
      config: { date: d.date, customerId: cust?.id || "", customerName: cust?.name || d.cust, deliveryTo: d.to, items: d.items.map((it: any, i: number) => ({ quantity: 1, deploymentType: "RENTAL", ...it })), remarks: d.note, createdBy: "xero-invoice-refs backfill 2026-08-27" },
    } });
    console.log(`✓ ${d.name} · ${cust?.name || d.cust} · ${d.date}`);
    created.push(d.name);
  }
  // fill the empty 0038 shell for Integrate Engineers
  const shell = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-0038" } });
  if (shell) {
    const c: any = shell.config || {};
    if (!(c.items || []).length) {
      const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "Integrate Engineers" } }, select: { id: true, name: true } });
      await prisma.document.update({ where: { id: shell.id }, data: { status: "delivered_installed" as any, config: { ...c, date: "2026-08-20", customerId: cust?.id, customerName: cust?.name, deliveryTo: "61 Joo Koon Circle", items: [{ quantity: 1, deploymentType: "RENTAL", description: "1x Energy Storage Power Supply System (model/serial TBC)" }], remarks: "⚠ Delivered 20.08.2026 — NO PO, NO invoice found anywhere. Rental-or-trial status unknown; unit serial TBC. Backfilled 2026-08-27." } } });
      console.log("✓ DO202608-0038 shell completed → Integrate Engineers, 61 Joo Koon Circle, 20.08");
    }
  }
  console.log(`\ndone: ${created.length} created + 1 shell filled`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
