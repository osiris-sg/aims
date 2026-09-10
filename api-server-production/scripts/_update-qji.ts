import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-006" } });
  const c: any = d!.config;
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c,
    items: [{ quantity: 1, deploymentType: "RENTAL", description: "1x Micro-Grid System LION375 (Year 2024)\nS/No.: MG2024009\n1x 60KVA Denyo DG DCA60ESI2 S/No. 3993245 Code G06095 (WITHOUT oil tray, per signed DO)\n1x 10m 25mm 5 core cable" }],
    remarks: String(c.remarks || "") + " | Signed DO read 11/09: unit = LION375 MG2024009 (not generic BESS); DO carries NO PO (field says 'Lentor Garden') and NO quote ref. Rate precedent: previous chain same site (MG20250085) billed $4,500/mth+GST under Qtn BI/EL/2026-0104, paid Nov25–Mar26.",
  } } });
  console.log("✓ DO202608-006 updated with signed-DO serials + rate note");
  process.exit(0);
})();
