/**
 * Round AN — READ-ONLY snapshot of ADH's shipments data (orders, supplier orders, shipments, steps with their slots,
 * linked files, contracts, step templates, doc types) as JSON, for the Drive-folder match. Writes nothing to the DB.
 * Usage: TENANCY_MODE= DATABASE_URL=<prod> npx ts-node --transpile-only scripts/_an-prod-snapshot.ts <out.json>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const p = new PrismaClient();
(async () => {
  const where = { organizationId: ADH };
  const fileSel = { select: { id: true, docType: true, fileName: true, docRef: true, source: true, sha256: true, sizeBytes: true, createdAt: true } };
  const linkSel = { select: { id: true, stepId: true, file: fileSel } };
  const stepSel = { select: { id: true, code: true, displayNo: true, title: true, status: true, requiredDocTypes: true, optionalDocTypes: true, requiredFields: true, notApplicable: true } };
  const out = {
    at: new Date().toISOString(),
    orders: await p.tradeOrder.findMany({ where, orderBy: { orderNo: 'asc' }, include: { customer: { select: { name: true } }, supplier: { select: { name: true } }, contract: { select: { contractNo: true } }, supplierOrder: { select: { soNo: true } }, steps: stepSel, fileLinks: linkSel } }),
    supplierOrders: await p.supplierOrder.findMany({ where, orderBy: { soNo: 'asc' }, include: { contract: { select: { contractNo: true } }, customerOrders: { select: { orderNo: true } }, steps: stepSel, fileLinks: linkSel } }),
    shipments: await p.shipment.findMany({ where, include: { order: { select: { orderNo: true } }, supplierOrder: { select: { soNo: true } }, steps: stepSel, fileLinks: linkSel } }),
    contracts: await p.contract.findMany({ where, include: { fileLinks: linkSel } }),
    stepTemplates: await p.tradeStepTemplate.findMany({ where, orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }] }),
    docTypes: await p.tradeDocType.findMany({ where, orderBy: { sortOrder: 'asc' } }),
    files: await p.tradeFile.findMany({ where, select: { id: true, docType: true, fileName: true, docRef: true, sha256: true, sizeBytes: true, source: true, createdAt: true, _count: { select: { links: true } } } }),
    setting: await p.tradeSetting.findFirst({ where }),
  };
  fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  console.log('orders', out.orders.length, 'SOs', out.supplierOrders.length, 'shipments', out.shipments.length, 'contracts', out.contracts.length, 'files', out.files.length);
  await p.$disconnect();
})();
