import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-017" } });
  const c: any = d!.config;
  const ref = "PO 64 OD BI-PO-01 (13.08.2026) · RENTAL $600/month · Attn site: Mark/Meiling 98666598";
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c,
    referenceNo: ref, documentInfo: { ...(c.documentInfo || {}), referenceNo: ref },
    deliveryTo: "64 Ocean Drive",
    nettTotal: 600,
    items: [{ quantity: 1, deploymentType: "RENTAL", description: "1x Advance Filtration System\nModel: AF5 (5m3/hr)\nRental $600/month" }],
    remarks: "Source: Prime Builders PO 64 OD BI-PO-01 dtd 13.08.2026 (rental $600/mth, requested delivery 14.08; Arun's log shows delivered 20.08). ⚠ NOT INVOICED — Aug pro-rata 20–31.08 ≈ $232.26 + Sept $600.",
  } } });
  console.log("✓ DO202608-017 rebuilt from PO: RENTAL $600/mth @ 64 Ocean Drive");
  process.exit(0);
})();
