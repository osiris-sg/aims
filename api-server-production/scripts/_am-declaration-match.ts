/**
 * Round AM — DRY RUN, read-only: Vedanta's October 2026 declaration / PIs and September 2026 shipping schedule (from
 * Sayaka's forwarded threads, 24–25 Oct — data, not verified against PI PDFs) matched to ADH's orders #14–#26.
 * Prints one row per line: order · PI no. · contract · premium · vessel / sailing · matched on, what WOULD be filled
 * (empty fields only) and what doesn't match. Writes nothing.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const p = new PrismaClient();

type Line = { src: string; customer: 'SUS' | 'KATO' | 'HOEI'; grade: string; qty: number; month: string; contract?: string; pi?: string; premium?: number; premiumNote?: string; vessel?: string; sailing?: string; note?: string };
const DECL: Line[] = [
  { src: 'Oct decl.', customer: 'SUS', grade: '6005', qty: 100, month: '2026-10', contract: '454003255', pi: '9331004319', premium: 162, premiumNote: '162 for the first 103 t on 454003255' },
  { src: 'Oct decl.', customer: 'SUS', grade: '6005', qty: 100, month: '2026-10', contract: '454003422', pi: '9331004321', premium: 240, premiumNote: '240 on 454003422' },
  { src: 'Oct decl.', customer: 'SUS', grade: '6063', qty: 200, month: '2026-10', contract: '454003422', pi: '9331004321', premium: 205, premiumNote: 'upcharge 205 (as written in the mail)' },
  { src: 'Oct decl.', customer: 'KATO', grade: '6063', qty: 40, month: '2026-10', contract: '454003598', pi: '9331004320' },
  { src: 'Oct decl.', customer: 'KATO', grade: '6005', qty: 40, month: '2026-10', contract: '454003598', pi: '9331004320' },
  { src: 'Sep sched.', customer: 'HOEI', grade: 'P1020', qty: 150, month: '2026-09', vessel: 'KOTA SELAMAT', sailing: '0523E · 22 Sep (Laem Chabang)' },
  { src: 'Sep sched.', customer: 'SUS', grade: '6005', qty: 25, month: '2026-09', vessel: 'WAN HAI 328', sailing: '22 Sep' },
  { src: 'Sep sched.', customer: 'KATO', grade: '6005', qty: 40, month: '2026-09', vessel: 'MARINA VOYAGER', sailing: 'MSK · 20 Sep', note: '36 t executed' },
  { src: 'Sep sched.', customer: 'KATO', grade: '6063 HSB', qty: 32, month: '2026-09', vessel: 'MARINA VOYAGER', sailing: 'MSK · 20 Sep' },
  { src: 'Sep sched.', customer: 'SUS', grade: '6063', qty: 300, month: '2026-09', vessel: 'WAN HAI 361', sailing: '28 Sep' },
  { src: 'Sep sched.', customer: 'KATO', grade: '6063', qty: 40, month: '2026-09', vessel: 'SITC CAGAYAN', sailing: '10 Oct (trial)' },
  { src: 'Sep sched.', customer: 'SUS', grade: '6005', qty: 220, month: '2026-09', vessel: 'WAN HAI 366', sailing: '06 Oct' },
  { src: 'Sep sched.', customer: 'KATO', grade: '6005', qty: 4, month: '2026-09', vessel: 'SITC (TBC)', sailing: 'TBC', note: 'the 4 t left of the 40 t' },
];
const keyOf = (name: string) => (/sus/i.test(name) ? 'SUS' : /kato|加藤/i.test(name) ? 'KATO' : /hou?ei/i.test(name) ? 'HOEI' : name);
const g = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
const vnorm = (s: string | null | undefined) => g(s).replace(/^(MSK|MAERSK|SITC|RCL)\s+/, '');

(async () => {
  const orders: any[] = await p.tradeOrder.findMany({
    where: { organizationId: ADH, isTest: false, orderNo: { gte: 14, lte: 26 } },
    orderBy: { orderNo: 'asc' },
    select: { orderNo: true, shipMonth: true, grade: true, qtyMt: true, piNo: true, piDate: true, piAmount: true, supplierPremium: true, clientPremium: true, upcharge: true, customer: { select: { name: true } }, contract: { select: { contractNo: true } }, supplierOrder: { select: { soNo: true, piNo: true, piDate: true, piAmount: true, supplierPremium: true, contract: { select: { contractNo: true } } } }, shipments: { select: { seqNo: true, blNumber: true, vessel: true, voyageNo: true, etd: true }, orderBy: { seqNo: 'asc' } } },
  });
  const out: string[] = [];
  for (const l of DECL) {
    // Order candidates: same customer, grade and ship month (a declaration line may be part of an order).
    const cands = orders.filter((o) => keyOf(o.customer?.name ?? '') === l.customer && g(o.grade) === g(l.grade) && o.shipMonth === l.month);
    const exact = cands.filter((o) => Number(o.qtyMt) === l.qty);
    const pick = exact[0] ?? cands[0];
    const head = `${l.src} | ${l.customer} ${l.grade} ${l.qty} t ${l.month}${l.contract ? ` · ${l.contract}` : ''}${l.pi ? ` · PI ${l.pi}` : ''}${l.premium !== undefined ? ` · premium ${l.premium}` : ''}${l.vessel ? ` · ${l.vessel} ${l.sailing}` : ''}`;
    if (!pick) {
      // Hoei's P1020 is declared for August in AIMS: look one month earlier.
      const prev = orders.find((o) => keyOf(o.customer?.name ?? '') === l.customer && g(o.grade).startsWith(g(l.grade)) && Number(o.qtyMt) === l.qty);
      if (!prev) { out.push(`${head}\n   → NO MATCH in #14–#26`); continue; }
      cands.push(prev);
    }
    const o = pick ?? cands[cands.length - 1];
    const on = [
      'customer',
      g(o.grade) === g(l.grade) ? 'grade' : `grade≠(${o.grade})`,
      Number(o.qtyMt) === l.qty ? 'qty' : `qty≠(${Number(o.qtyMt)} t)`,
      o.shipMonth === l.month ? 'month' : `month≠(${o.shipMonth})`,
      ...(l.contract ? [o.contract?.contractNo === l.contract ? 'contract' : `contract≠(${o.contract?.contractNo ?? '—'})`] : []),
    ];
    const fill: string[] = [];
    const issues: string[] = [];
    const so = o.supplierOrder;
    if (l.pi) {
      const cur = so?.piNo ?? o.piNo;
      if (!cur) fill.push(`PI no. ${l.pi} → ${so ? `S${so.soNo}` : 'order'} (+ order #${o.orderNo})`);
      else if (cur !== l.pi) issues.push(`PI in AIMS ${cur} ≠ ${l.pi}`);
      fill.push('PI date / amount stay blank (no PI PDF in the forwards)');
    }
    if (l.premium !== undefined) {
      const cur = so?.supplierPremium ?? o.supplierPremium;
      if (cur === null || cur === undefined) fill.push(`supplier premium ${l.premium}`);
      else if (Number(cur) !== l.premium) issues.push(`supplier premium AIMS ${Number(cur)} ≠ ${l.premium} (${l.premiumNote})`);
    }
    if (l.contract && o.contract?.contractNo !== l.contract) issues.push(`this ${l.qty} t is on ${l.contract}; AIMS #${o.orderNo} is on ${o.contract?.contractNo ?? '—'} — part of the order may need its own supplier order`);
    if (Number(o.qtyMt) !== l.qty && l.pi) issues.push(`AIMS #${o.orderNo} is ${Number(o.qtyMt)} t; this PI line is ${l.qty} t`);
    if (l.vessel) {
      const ships = o.shipments as any[];
      const hit = ships.filter((s) => vnorm(s.vessel).includes(vnorm(l.vessel)) || vnorm(l.vessel).includes(vnorm(s.vessel)) && !!s.vessel);
      const desc = ships.map((s) => `#${o.orderNo}-${s.seqNo} ${s.vessel ?? '—'} ${s.voyageNo ?? ''} ETD ${s.etd?.toISOString().slice(5, 10) ?? '—'}`).join('; ') || 'no shipment yet';
      if (hit.length) on.push(`vessel (${hit.map((s) => `#${o.orderNo}-${s.seqNo}`).join(', ')})`);
      else issues.push(`vessel: schedule ${l.vessel}, AIMS ${desc}`);
      // Which other order has that vessel?
      const elsewhere = orders.flatMap((x) => (x.shipments as any[]).filter((s) => vnorm(s.vessel) === vnorm(l.vessel) && x.orderNo !== o.orderNo).map((s) => `#${x.orderNo}-${s.seqNo} (${x.customer?.name?.split(' ')[0]} ${x.grade})`));
      if (!hit.length && elsewhere.length) issues.push(`${l.vessel} is on ${elsewhere.join(', ')} in AIMS`);
    }
    if (l.note) issues.push(l.note);
    out.push(`${head}\n   → #${o.orderNo}${so ? ` / S${so.soNo}` : ''}  matched on: ${on.join(', ')}${cands.length > 1 ? `  (candidates: ${cands.map((c) => `#${c.orderNo}`).join(', ')})` : ''}\n   would fill: ${fill.join('; ') || '—'}\n   check: ${issues.join('; ') || '—'}`);
  }
  console.log(out.join('\n'));
  console.log('\nClient premium 190 vs 200 (task-list sheet, round AH): ' + orders.filter((o) => [16, 18, 23].includes(o.orderNo)).map((o) => `#${o.orderNo} AIMS ${Number(o.clientPremium)}`).join(', ') + ' · sheet 200 (#23 "200 or 265") — not touched.');
  await p.$disconnect();
})();
