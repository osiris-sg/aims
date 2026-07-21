/** Verify every zip JP bill exists in PROD + enforce: account 442, no GST.
 *  Email-ingested ones carried an 18.35+1.65 split — flatten to no-tax
 *  keeping the same total. Reports everything it changes. */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const SP = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad/jp-bills';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
async function main() {
  const acct = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '442' }, select: { id: true, accountType: true, name: true } });
  console.log(`target account: 442 ${acct!.name} (type=${acct!.accountType})`);
  const parsed: any[] = JSON.parse(fs.readFileSync(`${SP}/jp-parsed.json`, 'utf8'));
  const bills = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  const byName = new Map(bills.map(b => [b.name, b]));

  // 1) presence of every zip invoice
  const missing = parsed.filter(b => !byName.has(b.num));
  console.log(`zip invoices: ${parsed.length}  in prod: ${parsed.length - missing.length}  MISSING: ${missing.length}`);
  for (const b of missing) console.log(`  ✗ missing: ${b.num}`);

  // extras in prod not in zip (informational)
  const zipNums = new Set(parsed.map(b => b.num));
  const extras = bills.filter(b => !zipNums.has(b.name));
  console.log(`prod JP bills not in this zip: ${extras.length} (${extras.map(e => e.name).join(', ').slice(0, 200)})`);

  // 2) enforce 442 + no-GST on ALL prod JP bills
  let taxFixed = 0, acctFixed = 0, clean = 0, posted = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    if ((c.billStatus || 'DRAFT') !== 'DRAFT' && c.billStatus !== 'PENDING_APPROVAL') posted++;
    const lines: any[] = c.lines || [];
    const needsAcct = lines.some(l => l.accountId !== acct!.id);
    const needsTax = Number(c.taxAmount || 0) !== 0 || c.amountsAre !== 'NO_TAX' || Number(c.subtotal) !== Number(c.totalAmount);
    if (!needsAcct && !needsTax) { clean++; continue; }
    const cfg = {
      ...c,
      lines: lines.map(l => ({ ...l, accountId: acct!.id })),
      subtotal: Number(c.totalAmount ?? c.subtotal ?? 0),
      taxAmount: 0,
      amountsAre: 'NO_TAX',
    };
    await p.document.update({ where: { id: b.id }, data: { config: cfg as unknown as Prisma.InputJsonValue } });
    if (needsTax) taxFixed++;
    if (needsAcct) acctFixed++;
  }
  console.log(`\nfixes: tax-flattened=${taxFixed} account-fixed=${acctFixed} already-clean=${clean} non-draft=${posted}`);

  // 3) final verification sweep
  const after = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { name: true, config: true } });
  let badTax = 0, badAcct = 0, total = 0;
  for (const b of after) {
    const c: any = b.config || {};
    if (Number(c.taxAmount || 0) !== 0 || c.amountsAre !== 'NO_TAX') { badTax++; console.log(`  ✗ tax: ${b.name}`); }
    if ((c.lines || []).some((l: any) => l.accountId !== acct!.id)) { badAcct++; console.log(`  ✗ acct: ${b.name}`); }
    total += Number(c.totalAmount || 0);
  }
  console.log(`\nFINAL: ${after.length} JP bills | non-zero-tax=${badTax} | non-442=${badAcct} | Σ total=S$${total.toFixed(2)}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => p.$disconnect());
