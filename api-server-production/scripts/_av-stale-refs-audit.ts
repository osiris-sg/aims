/**
 * Round AV (read-only): stored reason / summary texts of ADH emails that name an order or shipment by number
 * ("#25", "#25-1"). For each token: is it the live ref of the record the same decision points at, or an old
 * number (TradeOrder.previousOrderNos)? Prints counts and the unresolved old-number tokens. Writes nothing.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const TOK = /#(\d{1,5})(?:-(\d{1,3}))?/g;
(async () => {
  const prisma = new PrismaClient();
  const orders = await prisma.tradeOrder.findMany({ where: { organizationId: ORG }, select: { id: true, orderNo: true, previousOrderNos: true } });
  const ships = await prisma.shipment.findMany({ where: { organizationId: ORG }, select: { id: true, orderId: true, seqNo: true } });
  const noOf = new Map(orders.map((o) => [o.id, o.orderNo]));
  const live = (orderId?: string | null, shipmentId?: string | null) => {
    if (shipmentId) { const s = ships.find((x) => x.id === shipmentId); return s?.orderId ? `#${noOf.get(s.orderId)}${s.seqNo ? `-${s.seqNo}` : ''}` : null; }
    return orderId && noOf.has(orderId) ? `#${noOf.get(orderId)}` : null;
  };
  const oldNos = new Set(orders.flatMap((o) => o.previousOrderNos));
  const logs: any[] = await prisma.emailIngestLog.findMany({ where: { organizationId: ORG }, select: { id: true, subject: true, inboxState: true, actions: true, triage: true } });
  let texts = 0, withTok = 0, staleLocal = 0, unresolved: string[] = [];
  for (const l of logs) {
    const a: any = l.actions && typeof l.actions === 'object' ? l.actions : {};
    const pairs: Array<[string, string | null]> = [];
    if (a.matched) pairs.push([a.matched, live(a.suggested?.orderId ?? a.orderId, a.suggested?.shipmentId ?? a.shipmentId)]);
    for (const c of a.candidates ?? []) if (c?.ref) pairs.push([c.ref, live(c.orderId, c.shipmentId)]);
    for (const c of a.quoted ?? []) if (c?.ref) pairs.push([c.ref, live(c.orderId, c.shipmentId)]);
    const local = new Map(pairs.filter(([s, v]) => v && s !== v) as Array<[string, string]>);
    const strings: Array<[string, string]> = [];
    const push = (where: string, v: unknown) => { if (typeof v === 'string' && v) strings.push([where, v]); };
    push('reason', a.reason); push('keyLabel', a.keyLabel); push('matched', a.matched); push('backlog.reason', a.backlog?.reason);
    for (const s of a.sourceLines ?? []) push('sourceLines', s);
    for (const c of a.candidates ?? []) { push('cand.ref', c.ref); for (const r of c.reasons ?? []) push('cand.reason', r); }
    for (const c of a.quoted ?? []) push('quoted.ref', c.ref);
    push('question.secondText', a.question?.secondText); push('question.why', a.question?.why);
    push('issueProposal.title', a.issueProposal?.title);
    const t: any = l.triage && typeof l.triage === 'object' ? l.triage : {};
    push('summary', t.summary); push('summaryEn', t.summaryEn); push('summaryJa', t.summaryJa);
    for (const [where, s] of strings) {
      texts++;
      const toks = [...s.matchAll(TOK)].map((m) => m[0]);
      if (!toks.length) continue;
      withTok++;
      for (const tk of toks) {
        if (local.has(tk)) { staleLocal++; continue; }
        const n = Number(/#(\d+)/.exec(tk)![1]);
        if (oldNos.has(n)) unresolved.push(`${l.inboxState} ${where}: ${tk} in "${s.slice(0, 90)}" (${String(l.subject ?? '').slice(0, 40)})`);
      }
    }
  }
  console.log(`emails ${logs.length} · texts ${texts} · with a #ref ${withTok} · stale refs the decision itself resolves ${staleLocal} · old-number refs it can't resolve ${unresolved.length}`);
  for (const u of unresolved.slice(0, 60)) console.log('  ' + u);
  await prisma.$disconnect();
})();
