/** Insert 5 JP Pass bills into PROD Biofuel (trial batch, guru-approved).
 *  No tax, account 105 Contra (the "external pass" flow), DRAFT status. */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const SUPPLIER_ID = '647eb442-5446-4d2f-98ca-e0db3bd8296c'; // Jurong Port Pte Ltd
const ACCOUNT_ID = '85ada888-51a9-44dd-b5eb-1a34289ff6d5'; // 105 Contra account
const TEMPLATE_ID = '2399e9ab-b922-4b07-afaf-28a6036c5bae'; // Bill (Xero import)
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);

const BILLS = [
  { num: 'JP2604150047', date: '2026-04-15', amount: 20, duration: '16 Apr 2026 - 15 Apr 2027', sponsor: 'DENNIS HUIN SENG KEONG' },
  { num: 'JP2604150059', date: '2026-04-15', amount: 20, duration: '16 Apr 2026 - 15 Apr 2027', sponsor: 'DENNIS HUIN SENG KEONG' },
  { num: 'JP2604150065', date: '2026-04-15', amount: 20, duration: '16 Apr 2026 - 15 Apr 2027', sponsor: 'DENNIS HUIN SENG KEONG' },
  { num: 'JP2604150121', date: '2026-04-15', amount: 20, duration: '17 Apr 2026 - 16 Apr 2027', sponsor: 'DENNIS HUIN SENG KEONG' },
  { num: 'JP2604150122', date: '2026-04-15', amount: 20, duration: '17 Apr 2026 - 16 Apr 2027', sponsor: 'DENNIS HUIN SENG KEONG' },
];

async function main() {
  for (const b of BILLS) {
    const dupe = await p.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name: b.num }, select: { id: true } });
    if (dupe) { console.log(`  – ${b.num}: already in prod, skipped`); continue; }
    const config = {
      date: `${b.date}T00:00:00.000Z`,
      billDate: b.date,
      dueDate: b.date,
      supplierId: SUPPLIER_ID,
      supplier: { id: SUPPLIER_ID, name: 'Jurong Port Pte Ltd' },
      lines: [{
        description: `Administrative Fee - 365 Days for 1 Applications (Pass Duration: ${b.duration}) — Sponsor: ${b.sponsor}`,
        quantity: 1,
        unitPrice: b.amount,
        amount: b.amount,
        accountId: ACCOUNT_ID,
      }],
      subtotal: b.amount,
      taxAmount: 0,
      totalAmount: b.amount,
      amountPaid: 0,
      amountsAre: 'NO_TAX',
      billStatus: 'DRAFT',
      inboundChannel: 'MANUAL',
      currency: 'SGD',
      reference: 'JP Pass application',
      documentInfo: { currency: 'SGD' },
    };
    await p.document.create({
      data: {
        organizationId: ORG,
        documentTemplateId: TEMPLATE_ID,
        name: b.num,
        type: 'BILL',
        status: 'draft' as any,
        createdAt: new Date(`${b.date}T00:00:00.000Z`),
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(`  ✓ ${b.num}: created (S$${b.amount}, no tax, acct 105 Contra, DRAFT)`);
  }
  const total = await p.document.count({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } } });
  console.log(`\nprod now has ${total} JP bills`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
