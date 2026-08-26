import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const name of ["GB2600024766", "CN202606008", "GB2600018887"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name }, select: { name: true, type: true, config: true } });
    const c: any = d?.config || {};
    const di: any = c.documentInfo || {};
    console.log(`\n═══ ${name} [${d?.type}] subtype=${c.subtype} taxCode=${JSON.stringify(di.taxCode)} gstAmount=${di.gstAmount ?? c.taxAmount ?? c.xeroTax} gross=${c.xeroGross ?? c.totalAmount} itemsTaxTypes=${JSON.stringify([...new Set((c.items || []).map((i: any) => i.taxType))])}`);
  }
  process.exit(0);
})();
