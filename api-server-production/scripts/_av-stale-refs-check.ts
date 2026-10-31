/**
 * Round AV (read-only): what the cards will show for stored texts that name old order numbers — the same rules the
 * service applies (email-refs.ts: the decision's own ref ↔ record pairs, the reasoner note by its write time and the
 * renumber history). Prints before → after for every text that changes. Writes nothing.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { localRefMap, refFreshener, renumberEventsOf } from '../src/ingestion-email/email-refs';
const ORG = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1] ?? '056ed6da-42d3-438e-895b-84bb4df47a4c';
(async () => {
  const prisma = new PrismaClient();
  const rows: any[] = await (prisma as any).actionLog.findMany({ where: { organizationId: ORG, resource: 'trade-orders', action: 'UPDATE', actorId: { startsWith: 'system:' } }, select: { resourceId: true, createdAt: true, details: true } });
  const events = renumberEventsOf(rows);
  const orders = await prisma.tradeOrder.findMany({ where: { organizationId: ORG }, select: { id: true, orderNo: true } });
  const ships = await prisma.shipment.findMany({ where: { organizationId: ORG }, select: { id: true, orderId: true, seqNo: true } });
  const no = new Map(orders.map((o) => [o.id, o.orderNo]));
  const fresh = refFreshener(events, no);
  const live = (c: any) => (c?.shipmentId ? (() => { const s = ships.find((x) => x.id === c.shipmentId); return s?.orderId ? `#${no.get(s.orderId)}${s.seqNo ? `-${s.seqNo}` : ''}` : null; })() : c?.orderId && no.has(c.orderId) ? `#${no.get(c.orderId)}` : null);
  const logs: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG, inboxState: { in: ['UNMATCHED', 'SUGGESTED', 'UNSURE'] } }, select: { id: true, subject: true, actions: true } });
  let changed = 0;
  console.log(`renumber events ${events.length} · open cards ${logs.length}`);
  for (const l of logs) {
    const a: any = l.actions && typeof l.actions === 'object' ? l.actions : {};
    const local = localRefMap([...(a.candidates ?? []), ...(a.quoted ?? [])].map((c: any) => ({ stored: c?.ref, live: live(c) })));
    const pairs: Array<[string, string]> = [];
    for (const c of a.candidates ?? []) { const v = live(c); if (c?.ref && v && v !== c.ref) pairs.push([`candidate ${c.ref}`, v]); for (const r of c.reasons ?? []) { const f = fresh(r, { local }); if (f !== r) pairs.push([r, f]); } }
    for (const s of a.sourceLines ?? []) { const f = fresh(s, { local }); if (f !== s) pairs.push([s, f]); }
    if (a.reason) { const f = fresh(a.reason, { local, at: /^reasoner:/.test(a.reason) ? a.reasoner?.at ?? null : null }); if (f !== a.reason) pairs.push([a.reason.slice(0, 140), f.slice(0, 140)]); }
    if (pairs.length) {
      changed++;
      console.log(`— ${String(l.subject ?? '').slice(0, 70)}`);
      for (const [b, f] of pairs) console.log(`    ${b}\n      → ${f}`);
    }
  }
  console.log(`cards with a stale number fixed on screen: ${changed}`);
  await prisma.$disconnect();
})();
