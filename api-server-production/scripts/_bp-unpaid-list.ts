/**
 * Round BP item 7 — READ-ONLY: the Dashboard "Unpaid" lists as of today on prod (the service the card calls).
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bp-unpaid-list.ts
 */
import { PrismaClient } from '@prisma/client';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { TradeUnpaidService, UnpaidRow } from '../src/shipments/trade-unpaid.service';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const money = (v: number | null, c: string) => (v === null ? '—' : `${c} ${v.toLocaleString('en-US', { minimumFractionDigits: c === 'JPY' ? 0 : 2, maximumFractionDigits: c === 'JPY' ? 0 : 2 })}`);

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const svc = new TradeUnpaidService(p as any, new TradeDueService(p as any), null as any);
  const r = await svc.list(ADH);
  const show = (title: string, rows: UnpaidRow[], totals: Record<string, number>) => {
    console.log(`\n${title} (${rows.length})`);
    for (const x of rows) console.log(`  ${x.ref.padEnd(7)} | ${(x.counterparty ?? '—').slice(0, 28).padEnd(28)} | ${`${x.kind} ${x.documentNo ?? ''}`.slice(0, 36).padEnd(36)} | ${money(x.amount, x.currency).padStart(18)} | due ${x.dueDate ?? '—'} | ${x.daysLeft === null ? '—' : x.daysLeft < 0 ? `${-x.daysLeft}d OVERDUE` : `${x.daysLeft}d`} | ${x.status}${x.note ? ` | ${x.note}` : ''}`);
    console.log(`  totals: ${Object.entries(totals).map(([c, v]) => money(v, c)).join(' · ') || '—'}`);
  };
  console.log(`as of ${r.today}`);
  show('TO PAY', r.pay, r.payTotals);
  show('TO RECEIVE', r.receive, r.receiveTotals);
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
