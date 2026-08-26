import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const dup = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-019" } });
  if (dup) { await prisma.document.delete({ where: { id: dup.id } }); console.log("✓ deleted DO202608-019 (Woh Hup duplicate)"); }
  const t = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-016" } });
  const c: any = t!.config;
  const ref = "LION500 MG20260172 · 18 Holland Drive (site main-con: Woh Hup) · Arun log 25/8 · ⚠ NOT INVOICED";
  await prisma.document.update({ where: { id: t!.id }, data: { config: { ...c,
    referenceNo: ref, documentInfo: { ...(c.documentInfo || {}), referenceNo: ref },
    deliveryTo: "18 Holland Drive",
    remarks: (c.remarks || "") + " | Same delivery as Arun's 25/8 'Wohhup, 18 Holland Drive, 1x Lion 500' — billing customer is TANGLIN CORPORATION (guru 2026-08-27); Woh Hup is the site/main-con reference. Delivery 25/8 (portal doc created 26/8).",
    date: "2026-08-25",
  } } });
  console.log("✓ DO202608-016 (Tanglin) enriched: 18 Holland Drive, delivered 25/8, Woh Hup = site name");
  process.exit(0);
})();
