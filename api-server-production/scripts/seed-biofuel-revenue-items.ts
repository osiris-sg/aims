import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
function inferType(name: string): 'PRODUCT' | 'SERVICE' {
  const n = name.toLowerCase();
  if (/sales of|supply of|pump|solar panel|steel|container|woodchip|rca|diesel/.test(n)) return 'PRODUCT';
  return 'SERVICE'; // rental, transport, disposal, repair, shipping, etc.
}
async function main() {
  const accts = await p.chartOfAccount.findMany({ where: { organizationId: ORG, accountType: { in: ['SALES', 'INCOME'] }, isActive: true }, select: { id: true, code: true, name: true } });
  let created = 0, skipped = 0;
  for (const a of accts) {
    const name = a.name.replace(/^Sales\s*-\s*/i, '').replace(/^Other (Revenue|Income)\s*-\s*/i, '').trim();
    const exists = await p.revenueItem.findFirst({ where: { organizationId: ORG, name } });
    if (exists) { skipped++; continue; }
    await p.revenueItem.create({ data: { organizationId: ORG, name, type: inferType(a.name), accountCode: a.code, accountId: a.id, isActive: true } });
    created++;
  }
  console.log(`Seeded Biofuel revenue master file: created ${created}, skipped ${skipped} (already existed)`);
  const total = await p.revenueItem.count({ where: { organizationId: ORG } });
  console.log(`Total revenue items now: ${total}`);
  // show a few
  const sample = await p.revenueItem.findMany({ where: { organizationId: ORG }, take: 8, orderBy: { accountCode: 'asc' }, select: { name: true, type: true, accountCode: true } });
  for (const s of sample) console.log(`   [${s.type === 'PRODUCT' ? 'Item ' : 'Svc  '}] ${s.name.slice(0,40).padEnd(42)} → ${s.accountCode}`);
}
main().catch(e => console.log('ERR', e.message)).finally(() => p.$disconnect());
