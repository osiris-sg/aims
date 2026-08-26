import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-0042" } });
  const c: any = d!.config;
  const ref = "QJI-GCC requisition 23/07/2026 (REF: RENTAL) · term 08/08/2026 → 08/08/2027 · Attn: Sharif 91571066";
  await prisma.document.update({ where: { id: d!.id }, data: { config: {
    ...c,
    referenceNo: ref,
    documentInfo: { ...(c.documentInfo || {}), referenceNo: ref },
    deliveryTo: "Lentor Gardens LP26 (use location: TC-2)",
    attention: "Sharif · 91571066",
    items: [{ quantity: 1, deploymentType: "RENTAL", description: "1x Battery Energy Storage System 375KW/H (BESS)\nRequired on site: 08/08/2026 · Off-hire date per requisition: 08/08/2027" }],
    remarks: "Source: QJI-GCC site requisition dtd 23/07/2026 (applied by Jiayin, approved by Project PM). One-year rental term to 08/08/2027. ⚠ NOT YET INVOICED — no rate on requisition; quote/contract needed for billing. Same site previously had MGS collected 17/03/2026 (RTN-DO 202603-002).",
  } } });
  console.log("✓ DO202608-0042 rebuilt from the requisition PDF");
  process.exit(0);
})();
