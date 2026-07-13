import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  // A: the two missing credit notes
  for (const n of ['CN202606010', 'CN202606009']) {
    const d = await prisma.document.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name: n }, select: { type: true, status: true, config: true } });
    if (!d) { console.log(`${n}: NOT IN DB`); continue; }
    const c: any = d.config || {};
    console.log(`${n}: type=${d.type} status=${d.status} voided=${!!c.voided} taxCode=${c.documentInfo?.taxCode ?? 'MISSING'} subtype=${c.subtype} xeroTax=${c.xeroTax} itemTaxTypes=${[...new Set((c.items||[]).map((i:any)=>i.taxType))]}`);
  }
  // B: one of the big bills
  const b = await prisma.document.findFirst({ where: { organizationId: BIOFUEL_ORG_ID, name: 'Inv-26040015' }, select: { status: true, config: true } });
  const c: any = b?.config || {};
  console.log(`\nInv-26040015: status=${b?.status} keys=${Object.keys(c).sort().join(',')}`);
  console.log(`  xeroGross=${c.xeroGross} xeroSubtotal=${c.xeroSubtotal} xeroTax=${c.xeroTax} totalAmount=${c.totalAmount} nettTotal=${c.nettTotal} subTotal=${c.subTotal} subtotal=${c.subtotal}`);
  console.log(`  documentInfo=${JSON.stringify(c.documentInfo)}`);
  console.log(`  items: ${(c.items||[]).length}`);
  for (const it of (c.items || []).slice(0, 6)) console.log(`    amt=${it.amount} tax=${it.taxAmount} type=${it.taxType} desc=${(it.description||'').slice(0,40)}`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
