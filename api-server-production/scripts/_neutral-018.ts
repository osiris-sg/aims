import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "DELIVERY_ORDER", name: "DO202608-018" } });
  const c: any = d!.config;
  const ref = "Arun log 22/8 · full set LION250+DG+cable · exchange-or-additional UNCONFIRMED · no PO/signed DO yet";
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c,
    referenceNo: ref, documentInfo: { ...(c.documentInfo || {}), referenceNo: ref },
    items: [{ quantity: 1, deploymentType: "RENTAL", description: "1x Micro-Grid System LION250\n1x 60ES Diesel Generator\n1x 10m 25mm cable" }],
    remarks: "Arun 22/8: 'CCG, Location T5, 1x Lion 250 + 60es DG + cable' — CCG = Capital Cranes Global (sub-contract J14350/SC/BPO/1025). OPEN QUESTION: either (a) the LION250 exchange promised in the T5 invoice remark — but a swap wouldn't need a new DG+cable — or (b) an ADDITIONAL 4th unit at T5 (site already runs MG20250110/126/128). No return of a LION375 documented. If (b): NEW UNBILLED RENTAL. Confirm with Arun/Heimen + get signed DO.",
  } } });
  console.log("✓ DO202608-018 set to neutral exchange-or-additional wording");
  process.exit(0);
})();
