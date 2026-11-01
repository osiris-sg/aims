// Round AZ — READ-ONLY on prod: with due dates switched on today (Tokyo), what would show — due in the next 7 days,
// overdue, and the backlog that is shown without the badge. Usage (after nest build): DBURL=… node scripts/_az-due-count.js [since]
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { TradeDueService } = require(path.join(__dirname, '..', 'dist', 'src', 'shipments', 'trade-due.service.js'));
const { tradeToday } = require(path.join(__dirname, '..', 'dist', 'src', 'shipments', 'shipments.rules.js'));
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
(async () => {
  const today = tradeToday();
  const since = process.argv[2] || today;
  const svc = new TradeDueService(p);
  svc.dueConfig = async () => ({ on: true, since });
  const items = await svc.openItems(ORG, today);
  const until = new Date(`${today}T00:00:00Z`); until.setUTCDate(until.getUTCDate() + 7);
  const lim = until.toISOString().slice(0, 10);
  const next7 = items.filter((i) => i.flagged && i.due && i.due >= today && i.due <= lim);
  const overdue = items.filter((i) => i.state === 'overdue');
  const quiet = items.filter((i) => i.due && !i.flagged);
  console.log(`today ${today} · since ${since} · open steps ${items.length}`);
  console.log(`due in the next 7 days (${today} → ${lim}): ${next7.length}`);
  for (const i of next7.sort((a, b) => a.due.localeCompare(b.due))) console.log(`  ${i.due} ${i.ref.padEnd(7)} step ${i.no.padEnd(3)} ${i.title}`);
  console.log(`overdue now: ${overdue.length}`);
  console.log(`older due dates shown without the badge: ${quiet.length}`);
  console.log(`no date yet: ${items.filter((i) => !i.due && !i.ongoing).length}`);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
