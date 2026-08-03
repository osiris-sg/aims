// Second, stronger linking pass for BillPayments left unlinked by pass 1
// (guru 2026-08-03). Evidence, in order:
//   R1: journal text contains the BILL NUMBER + amount matches.
//   R2: journal text contains the SUPPLIER NAME + amount matches, date ±3d.
//   R3: same-supplier group closure — all payments in a (date,amount) group
//       belong to ONE supplier and group sizes match the unused journals →
//       pair off (any pairing is correct since names are identical).
//   R4: unique amount match with date relaxed to ±2 days.
// Usage: npx ts-node scripts/backfill-payment-links-pass2.ts --env dev --apply
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const args = process.argv.slice(2);
const ENV = (args[args.indexOf('--env') + 1] || 'dev') as 'dev' | 'staging' | 'prod';
const APPLY = args.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const DAY = 24 * 3600 * 1000;
const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
const m = fs.readFileSync(path.resolve(__dirname, '..', envFile), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const R = (n: number) => Math.round(n * 100) / 100;
const norm = (x: string) => x.toLowerCase().replace(/pte|ltd|pte\.|ltd\.|private|limited|\(s\)|&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  const unlinked = await p.billPayment.findMany({
    where: { organizationId: ORG, journalEntryId: null, xeroId: { not: null } },
    include: { supplier: { select: { name: true } } },
  });
  const billIds = [...new Set(unlinked.map((b) => b.billId))];
  const bills = await p.document.findMany({ where: { id: { in: billIds } }, select: { id: true, name: true } });
  const billName = new Map(bills.map((b) => [b.id, b.name || '']));

  const usedIds = new Set<string>([
    ...((await p.billPayment.findMany({ where: { organizationId: ORG, journalEntryId: { not: null } }, select: { journalEntryId: true } })).map((x) => x.journalEntryId!) as string[]),
    ...(((await p.payment.findMany({ where: { organizationId: ORG, journalEntryId: { not: null } } as any, select: { journalEntryId: true } as any })) as any[]).map((x) => x.journalEntryId)),
  ]);
  const jes = (await p.journalEntry.findMany({
    where: { organizationId: ORG, type: 'PAYMENT', journalNumber: { startsWith: 'JV-XERO' }, status: { not: 'VOID' } },
    select: { id: true, reference: true, description: true, entryDate: true, lines: { select: { credit: true } } },
  })).filter((j) => !usedIds.has(j.id) && /ACCPAYPAYMENT|CASHPAID/i.test(j.description || ''));

  type J = { id: string; text: string; date: Date; amts: Set<number> };
  const cands: J[] = jes.map((j) => ({
    id: j.id,
    text: `${j.reference || ''} ${j.description || ''}`.toLowerCase(),
    date: j.entryDate,
    amts: new Set(j.lines.filter((l) => l.credit > 0).map((l) => R(l.credit))),
  }));
  const taken = new Set<string>();
  const links: Array<{ bpId: string; jeId: string; rule: string }> = [];
  const counts: Record<string, number> = { R1: 0, R2: 0, R3: 0, R4: 0 };

  const remaining = [...unlinked];
  // R1 + R2
  for (const bp of remaining) {
    const amt = R(bp.amount);
    const bn = (billName.get(bp.billId) || '').toLowerCase();
    const sn = norm(bp.supplier?.name || '');
    const inWindow = (j: J, days: number) => Math.abs(j.date.getTime() - bp.paymentDate.getTime()) <= days * DAY;
    let hit = bn.length >= 6 ? cands.filter((j) => !taken.has(j.id) && j.amts.has(amt) && j.text.includes(bn)) : [];
    let rule = 'R1';
    if (hit.length !== 1 && sn.length >= 6) {
      hit = cands.filter((j) => !taken.has(j.id) && j.amts.has(amt) && inWindow(j, 3) && norm(j.text).includes(sn));
      rule = 'R2';
    }
    if (hit.length === 1) {
      taken.add(hit[0].id);
      links.push({ bpId: bp.id, jeId: hit[0].id, rule });
      counts[rule]++;
    }
  }
  const linkedIds = new Set(links.map((l) => l.bpId));
  // R3: same-supplier group closure on (date, amount)
  const groups = new Map<string, typeof remaining>();
  for (const bp of remaining.filter((b) => !linkedIds.has(b.id))) {
    const k = `${bp.paymentDate.toISOString().slice(0, 10)}|${R(bp.amount).toFixed(2)}`;
    groups.set(k, [...(groups.get(k) || []), bp]);
  }
  for (const [k, grp] of groups) {
    const suppliers = new Set(grp.map((g) => g.supplierId));
    if (suppliers.size !== 1) continue;
    const [dateStr, amtStr] = k.split('|');
    const amt = Number(amtStr);
    const js = cands.filter((j) => !taken.has(j.id) && j.amts.has(amt) && j.date.toISOString().slice(0, 10) === dateStr);
    if (js.length < grp.length) continue; // not enough journals — leave
    for (let i = 0; i < grp.length; i++) {
      taken.add(js[i].id);
      links.push({ bpId: grp[i].id, jeId: js[i].id, rule: 'R3' });
      counts.R3++;
      linkedIds.add(grp[i].id);
    }
  }
  // R4: relaxed unique date±2
  for (const bp of remaining.filter((b) => !linkedIds.has(b.id))) {
    const amt = R(bp.amount);
    const hit = cands.filter((j) => !taken.has(j.id) && j.amts.has(amt) && Math.abs(j.date.getTime() - bp.paymentDate.getTime()) <= 2 * DAY);
    if (hit.length === 1) {
      taken.add(hit[0].id);
      links.push({ bpId: bp.id, jeId: hit[0].id, rule: 'R4' });
      counts.R4++;
      linkedIds.add(bp.id);
    }
  }

  console.log(`[${ENV}] unlinked=${unlinked.length} → ${APPLY ? 'linking' : 'would link'} ${links.length}  ${JSON.stringify(counts)}  still-unlinked=${unlinked.length - links.length}`);
  if (APPLY) {
    for (const l of links) await p.billPayment.update({ where: { id: l.bpId }, data: { journalEntryId: l.jeId } });
    console.log('applied');
  } else console.log('dry-run — pass --apply');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); }).finally(() => p.$disconnect());
