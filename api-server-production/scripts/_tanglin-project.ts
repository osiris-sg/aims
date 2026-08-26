import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const APPLY = process.argv.includes('--apply');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const recent = await p.project.findMany({ where: { organizationId: BF }, orderBy: { createdAt: 'desc' }, take: 8, select: { projectNumber: true, name: true, status: true, customerId: true, address: true } });
  console.log('recent Biofuel projects:');
  for (const r of recent) console.log(' ', r.projectNumber, '|', r.name, '|', r.status, '|', r.address || '-');
  const dupe = await p.project.findFirst({ where: { organizationId: BF, name: { equals: '18 Holland Drive', mode: 'insensitive' } } });
  console.log('existing "18 Holland Drive":', dupe ? dupe.id : 'none');
  if (APPLY && !dupe) {
    const created = await p.project.create({
      data: {
        name: '18 Holland Drive',
        address: '18 Holland Drive',
        organizationId: BF,
        customerId: '909c42f6-b361-4c07-a905-e45fa2774f03',
        status: 'ongoing',
      },
    });
    console.log('CREATED:', created.id, created.name);
  }
  await p.$disconnect();
})();
