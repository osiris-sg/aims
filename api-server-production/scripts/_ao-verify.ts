/**
 * Round AO — READ-ONLY verification after the go: per order what the Drive / go runs wrote (files, fields), the new
 * records' state (completed, no open step), counts written vs planned, and that no other org has a row by these jobs.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const JOBS = ['system:round-an-drive', 'system:round-ao-go'];
const p = new PrismaClient();
(async () => {
  const files = await p.tradeFile.findMany({ where: { uploadedById: 'system:round-an-drive' }, select: { id: true, organizationId: true, links: { select: { hiddenAt: true, shipment: { select: { seqNo: true, order: { select: { orderNo: true } } } }, order: { select: { orderNo: true } }, contract: { select: { contractNo: true } } } } } });
  const other = files.filter((f) => f.organizationId !== ORG).length;
  const logsOther = await p.actionLog.count({ where: { actorId: { in: JOBS }, organizationId: { not: ORG } } });
  const perOrder = new Map<string, number>();
  let links = 0;
  for (const f of files) for (const l of f.links) {
    links++;
    const k = l.shipment ? `#${l.shipment.order?.orderNo}` : l.order ? `#${l.order.orderNo}` : `K:${l.contract?.contractNo}`;
    perOrder.set(k, (perOrder.get(k) ?? 0) + 1);
  }
  const fills = await p.actionLog.findMany({ where: { organizationId: ORG, actorId: { in: JOBS }, action: 'UPDATE', resource: { in: ['shipment', 'trade-order', 'supplier-order'] } }, select: { details: true } });
  const fillPer = new Map<string, string[]>();
  for (const f of fills) { const d: any = f.details; const k = String(d.ref ?? '').replace(/-\d+$/, ''); (fillPer.get(k) ?? fillPer.set(k, []).get(k)!).push(`${String(d.ref).includes('-') ? String(d.ref).split('-')[1] + ':' : ''}${d.field}`); }
  console.log(`files uploaded by the Drive job: ${files.length} (other orgs ${other}); links ${links}; Activity Log rows of these jobs in other orgs: ${logsOther}`);
  const keys = [...new Set([...perOrder.keys(), ...fillPer.keys()])].sort((a, b) => (a.startsWith('K') ? 1 : 0) - (b.startsWith('K') ? 1 : 0) || Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  for (const k of keys) console.log(`  ${k.padEnd(12)} files ${String(perOrder.get(k) ?? 0).padStart(3)} · fields ${fillPer.get(k)?.length ?? 0}${fillPer.get(k) ? ` (${[...new Set(fillPer.get(k))].join(', ')})` : ''}`);
  const created = await p.tradeOrder.findMany({ where: { organizationId: ORG, year: 2026, orderNo: { in: [2, 8, 9, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40] } }, orderBy: { orderNo: 'asc' }, select: { orderNo: true, status: true, isTest: true, qtyMt: true, grade: true, shipMonth: true, customer: { select: { name: true } }, steps: { select: { status: true, notApplicable: true, isOngoing: true } }, shipments: { orderBy: { seqNo: 'asc' }, select: { seqNo: true, status: true, blNumber: true, netWeightMt: true, steps: { select: { status: true, notApplicable: true, isOngoing: true } } } } } });
  const open = (ss: any[]) => ss.filter((s) => !s.notApplicable && !s.isOngoing && s.status !== 'DONE').length;
  console.log('\nnew / split records:');
  for (const o of created) console.log(`  #${o.orderNo} ${o.customer.name.slice(0, 12).padEnd(12)} ${o.grade} ${Number(o.qtyMt)} t ship ${o.shipMonth} ${o.status}${o.isTest ? ' TEST' : ''} open steps ${open(o.steps)} | ${o.shipments.map((s) => `#${o.orderNo}-${s.seqNo} ${s.blNumber} ${Number(s.netWeightMt)} t ${s.status} open ${open(s.steps)}`).join(' | ')}`);
  const plan1 = JSON.parse(fs.readFileSync('scripts/_an-drive-plan.json', 'utf8')).plan.filter((x: any) => x.kind === 'attach').length;
  const plan2 = JSON.parse(fs.readFileSync('scripts/_ao-drive-plan2.json', 'utf8')).plan.length;
  const logA = JSON.parse(fs.readFileSync('scripts/_an-drive-backfill.log.json', 'utf8'));
  console.log(`\nplanned attaches: round AN plan ${plan1} (4 already on the record) + round AO plan ${plan2}; Drive log CREATE ${logA.filter((l: any) => l.action === 'CREATE' && l.resource === 'trade-file').length}, LINK ${logA.filter((l: any) => l.action === 'LINK').length}, field UPDATE ${logA.filter((l: any) => l.action === 'UPDATE' && l.resource !== 'trade-file').length}`);
  await p.$disconnect();
})();
