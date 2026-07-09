import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production', override: true });
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  const recent = await prisma.documentTemplate.findMany({
    where: { OR: [ { createdAt: { gte: new Date('2026-06-25') } }, { updatedAt: { gte: new Date('2026-07-01') } } ] },
    select: { id: true, name: true, type: true, templateVariant: true, organizationId: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  console.log('Templates created since 25 Jun or updated since 1 Jul:');
  recent.forEach((t) => console.log(`  ${t.type} | "${t.name}" | ${t.id} | org=${t.organizationId?.slice(0,8)} | created=${t.createdAt.toISOString().slice(0,10)} updated=${t.updatedAt.toISOString().slice(0,16)}`));
  const doTypes = await prisma.documentTemplate.findMany({
    where: { type: { in: ['DO', 'RDO'] } },
    select: { id: true, name: true, type: true, organizationId: true, createdAt: true, updatedAt: true },
  });
  console.log('type=DO/RDO templates:', doTypes.length);
  doTypes.forEach((t) => console.log(`  ${t.type} | "${t.name}" | ${t.id} | org=${t.organizationId?.slice(0,8)} | updated=${t.updatedAt.toISOString().slice(0,16)}`));
}
main().finally(() => prisma.$disconnect());
