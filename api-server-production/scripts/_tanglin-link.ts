import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const APPLY = process.argv.includes('--apply');
const TANGLIN = '909c42f6-b361-4c07-a905-e45fa2774f03';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const proj = await p.project.findUnique({ where: { id: '0fbb39e2-ef79-4339-be14-1468041061ce' }, include: { customer: { select: { name: true, customerCode: true } } } });
  console.log('project:', proj?.name, '| status:', proj?.status, '| customer:', proj?.customer?.name || 'NONE', '| created:', proj?.createdAt?.toISOString());
  if (APPLY && proj && proj.customerId !== TANGLIN) {
    const u = await p.project.update({ where: { id: proj.id }, data: { customerId: TANGLIN }, include: { customer: { select: { name: true, customerCode: true } } } });
    console.log('LINKED to:', u.customer?.name, u.customer?.customerCode);
  }
  await p.$disconnect();
})();
