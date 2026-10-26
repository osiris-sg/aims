/** Round AM — read-only: ADH customers, suppliers, profiles, contracts, orders, contract files. Prints no secrets. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const ADH = process.argv.find((a) => a.startsWith('--org='))?.slice(6) ?? '056ed6da-42d3-438e-895b-84bb4df47a4c';
const p = new PrismaClient();
(async () => {
  const cust = await p.customer.findMany({ where: { organizationId: ADH }, select: { id: true, customerCode: true, name: true, jpName: true, jpAddress: true, jpContact: true, email: true, currency: true, _count: { select: { tradeOrders: true, shipments: true, contracts: true, contacts: true } } } });
  console.log('CUSTOMERS', JSON.stringify(cust, null, 1));
  const sup = await p.supplier.findMany({ where: { organizationId: ADH }, select: { id: true, supplierCode: true, name: true, email: true, address: true, currency: true, _count: { select: { tradeOrders: true, supplierOrders: true, contracts: true } } } });
  console.log('SUPPLIERS', JSON.stringify(sup, null, 1));
  const contacts = await p.customerContact.findMany({ where: { customer: { organizationId: ADH } } as any }).catch((e) => String(e).slice(0, 200));
  console.log('CUSTOMER CONTACTS', JSON.stringify(contacts, null, 1));
  const ts = await p.tradeSetting.findUnique({ where: { organizationId: ADH } });
  console.log('CUSTOMER PROFILES', JSON.stringify(ts?.customerProfiles, null, 1));
  console.log('SUPPLIER PROFILES', JSON.stringify(ts?.supplierProfiles, null, 1));
  const dd = (ts?.docDefaults ?? {}) as any;
  console.log('docDefaults keys', Object.keys(dd));
  console.log('docDefaults.deliveryProfiles', JSON.stringify(dd.deliveryProfiles ?? null, null, 1));
  const contracts = await p.contract.findMany({ where: { organizationId: ADH }, select: { id: true, contractNo: true, status: true, grade: true, periodStart: true, periodEnd: true, annualQtyMt: true, qpBasis: true, premiumSchedule: true, balanceTerms: true, customer: { select: { name: true } }, supplier: { select: { name: true } }, lines: { select: { grade: true, sizeSpec: true, quantityMt: true, supplierPremium: true, clientPremium: true, upcharge: true } }, _count: { select: { fileLinks: true, orders: true } } } });
  console.log('CONTRACTS', JSON.stringify(contracts, null, 1));
  const cfl = await p.tradeFileLink.findMany({ where: { organizationId: ADH, contractId: { not: null } } as any, select: { contractId: true, file: { select: { docType: true, fileName: true, docRef: true } } } as any }).catch((e) => String(e).slice(0, 300));
  console.log('CONTRACT FILE LINKS', JSON.stringify(cfl, null, 1));
  const orders = await p.tradeOrder.findMany({ where: { organizationId: ADH }, orderBy: [{ year: 'asc' }, { orderNo: 'asc' }], select: { year: true, orderNo: true, isTest: true, status: true, shipMonth: true, deliveryMonth: true, grade: true, size: true, qtyMt: true, clientPremium: true, supplierPremium: true, upcharge: true, piNo: true, piDate: true, customer: { select: { name: true } }, supplier: { select: { name: true } }, contract: { select: { contractNo: true } }, supplierOrder: { select: { soNo: true, piNo: true, declarationMonth: true } }, shipments: { select: { seqNo: true, blNumber: true, vessel: true, voyageNo: true, etd: true, eta: true, status: true } as any } } as any });
  for (const o of orders as any[]) console.log(`#${o.orderNo}${o.isTest ? ' TEST' : ''} ${o.status} ${o.customer?.name} / ${o.supplier?.name} ${o.contract?.contractNo ?? '-'} ship ${o.shipMonth} dlv ${o.deliveryMonth} ${o.grade} ${o.size ?? ''} ${o.qtyMt}t cp ${o.clientPremium} sp ${o.supplierPremium} up ${o.upcharge} PI ${o.piNo ?? '-'} ${o.piDate?.toISOString().slice(0, 10) ?? ''} SO ${o.supplierOrder ? `S${o.supplierOrder.soNo} ${o.supplierOrder.piNo ?? ''} ${o.supplierOrder.declarationMonth ?? ''}` : '-'} | ${(o.shipments ?? []).map((s: any) => `${s.seqNo ?? '?'}:${s.blNumber ?? '-'} ${s.vessel ?? ''} ${s.voyageNo ?? ''} etd ${s.etd?.toISOString().slice(0, 10) ?? ''} ${s.status}`).join(' ; ')}`);
  const sos = await p.supplierOrder.findMany({ where: { organizationId: ADH }, select: { soNo: true, piNo: true, piDate: true, declarationMonth: true, grade: true, qtyMt: true, supplierPremium: true, status: true, contract: { select: { contractNo: true } } } });
  console.log('SUPPLIER ORDERS', JSON.stringify(sos));
  await p.$disconnect();
})();
