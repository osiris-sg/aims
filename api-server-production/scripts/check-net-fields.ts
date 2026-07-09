import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const inv = await p.document.findFirst({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', type: 'INVOICE', config: { path: ['xeroImported'], equals: true } }, select: { config: true } });
  const c: any = inv?.config || {};
  console.log('imported invoice keys:', Object.keys(c).filter(k => /xero|total|net|sub|gst|tax/i.test(k)));
  console.log(JSON.stringify({ xeroGross: c.xeroGross, xeroNet: c.xeroNet, xeroTax: c.xeroTax, subTotal: c.subTotal, gstAmount: c.gstAmount, nettTotal: c.nettTotal }));
  const bill = await p.document.findFirst({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', type: 'BILL' }, select: { config: true } });
  const b: any = bill?.config || {};
  console.log('bill keys:', Object.keys(b).filter(k => /xero|total|net|sub|gst|tax/i.test(k)));
  console.log(JSON.stringify({ xeroGross: b.xeroGross, xeroNet: b.xeroNet, xeroTax: b.xeroTax, subTotal: b.subTotal }));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
