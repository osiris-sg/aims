import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-018" } });
  const c: any = d!.config;
  const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "Capital Cranes" } }, select: { id: true, name: true } });
  const ref = "EXCHANGE per invoice remark 'site requested LION250' · Arun log 22/8 · no PO/DO in folder yet";
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c,
    customerId: cust!.id, customerName: cust!.name,
    deliveryTo: "T5 Substructure Project, 35A Tanah Merah Coast Road",
    referenceNo: ref, documentInfo: { ...(c.documentInfo || {}), referenceNo: ref },
    items: [{ quantity: 1, deploymentType: "RENTAL", description: "1x Micro-Grid System LION250 (exchange for LION375 on T5 chain)\n1x 60ES Diesel Generator\n1x 10m 25mm cable" }],
    remarks: "Arun's log 22/8: 'CCG, Location T5, 1x Lion 250 + 60es DG + cable'. CCG = Capital Cranes Global (sub-contract J14350/SC/BPO/1025). This is the LION250 exchange promised in the T5 invoice remark ('will exchange to LION250 in a later date'). Arun 24/8 'Return delivery this' = likely the LION375 collection (RTN not yet documented). ⚠ Sept rate for this chain may change (LION250 vs LION375) — confirm with quotation Qtn-BI/BT/2025-0801.",
  } } });
  console.log(`✓ DO202608-018 → ${cust!.name}, T5 exchange`);
  process.exit(0);
})();
