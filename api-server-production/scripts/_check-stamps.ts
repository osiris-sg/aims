import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

async function check(envFile: string, label: string) {
  dotenv.config({ path: envFile, override: true });
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const org = await prisma.organization.findFirst({
      where: { name: { contains: 'Biofuel' } },
      select: { id: true, name: true, defaultStamp: true, logo: true },
    });
    console.log(`${label}: org=${org?.id?.slice(0,8)} stamp=${org?.defaultStamp ? String(org.defaultStamp).slice(0, 70) : 'NULL'} logo=${org?.logo ? 'set' : 'NULL'}`);
    const doTemplates = await prisma.documentTemplate.findMany({
      where: { type: { in: ['DO', 'DELIVERY_ORDER'] }, organizationId: org?.id ?? undefined },
      select: { id: true, name: true, type: true, updatedAt: true },
    });
    doTemplates.forEach((t) => console.log(`   tmpl: ${t.type} ${t.id.slice(0,8)} "${t.name}" updated=${t.updatedAt.toISOString().slice(0,10)}`));
  } finally {
    await prisma.$disconnect();
  }
}
async function main() {
  await check('.env.production', 'PROD   ');
  await check('.env.staging', 'STAGING');
  await check('.env', 'DEV    ');
}
main();
