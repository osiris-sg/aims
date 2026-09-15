// Financial statements data for U2CAN COMBAT PTE LTD (dev books).
// Prints TB / P&L / BS and dumps JSON for the PDF renderer.
//   npx ts-node --transpile-only scripts/_u2can-fs.ts .env <out.json>
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env';
const outFile = process.argv[3];
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const f = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(14);

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: { contains: 'U2CAN', mode: 'insensitive' } } });
  if (!org) { console.log('no org'); return; }
  const lines = await prisma.journalEntryLine.findMany({
    where: { journalEntry: { organizationId: org.id, status: 'POSTED' } },
    include: { account: { select: { code: true, name: true, category: true, accountType: true } } },
  });
  const bal = new Map<string, { name: string; cat: string; type: string; d: number; c: number }>();
  for (const l of lines as any[]) {
    const k = l.account.code;
    const b = bal.get(k) || { name: l.account.name, cat: l.account.category, type: l.account.accountType, d: 0, c: 0 };
    b.d += l.debit; b.c += l.credit; bal.set(k, b);
  }
  const rows = [...bal].sort().map(([code, b]) => ({ code, name: b.name, cat: b.cat, type: b.type, net: Math.round((b.d - b.c) * 100) / 100 }));

  console.log('════════ TRIAL BALANCE ════════');
  let TD = 0, TC = 0;
  for (const r of rows) { const dr = r.net > 0 ? r.net : 0, cr = r.net < 0 ? -r.net : 0; TD += dr; TC += cr;
    console.log(`${r.code.padEnd(7)} ${r.name.slice(0, 38).padEnd(38)} ${dr ? f(dr) : ''.padStart(14)} ${cr ? f(cr) : ''.padStart(14)}`); }
  console.log(`${''.padEnd(46)} ${f(TD)} ${f(TC)}  ${Math.abs(TD - TC) < 0.005 ? '✓' : '✗'}`);

  const REV = ['SALES', 'INCOME'], EXP = ['EXPENSE', 'PURCHASE', 'TAX', 'EXCHANGE_GAIN_LOSS'];
  const revenue = rows.filter((r) => REV.includes(r.type)).reduce((s, r) => s - r.net, 0);
  const expenses = rows.filter((r) => EXP.includes(r.type)).reduce((s, r) => s + r.net, 0);
  console.log(`\nP&L: revenue ${f(revenue)}  expenses ${f(expenses)}  net ${f(revenue - expenses)}`);

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({ org: org.name, orgId: org.id, rows, revenue, expenses }, null, 1));
    console.log(`wrote ${outFile}`);
  }
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
