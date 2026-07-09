import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production', override: true });
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  const candidates = await prisma.documentTemplate.findMany({
    where: { type: { in: ['DO', 'DELIVERY_ORDER', 'RDO'] }, organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1' },
    select: { id: true, name: true, type: true, config: true, updatedAt: true, createdAt: true },
  });
  for (const t of candidates) {
    const cfg: any = t.config ?? {};
    const stampKeys = JSON.stringify(cfg).match(/stamp/gi)?.length ?? 0;
    const stampVal = cfg.stamp ? (typeof cfg.stamp === 'object' ? Object.keys(cfg.stamp) : String(cfg.stamp).slice(0, 60)) : null;
    console.log(`${t.type} | "${t.name}" | ${t.id} | created=${t.createdAt.toISOString().slice(0,10)} updated=${t.updatedAt.toISOString().slice(0,16)} | stampMentions=${stampKeys} stamp=${JSON.stringify(stampVal)?.slice(0,120)}`);
  }
}
main().finally(() => prisma.$disconnect());
