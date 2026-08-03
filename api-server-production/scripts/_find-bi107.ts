import * as dotenv from 'dotenv';
import * as path from 'path';
const ENV = process.argv[2] || 'dev';
const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  const docs = await p.document.findMany({
    where: { OR: [
      { name: { contains: 'BI202607107', mode: 'insensitive' } },
      { config: { path: ['invoiceNumber'], string_contains: 'BI202607107' } as any },
    ] },
    select: { id: true, name: true, type: true, status: true, organizationId: true, createdAt: true, config: true,
      organization: { select: { name: true } } },
  });
  console.log(`[${ENV}] docs:`, JSON.stringify(docs, null, 2));
  const custs = await p.customer.findMany({
    where: { name: { contains: 'sin hua', mode: 'insensitive' } },
    select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } },
  });
  console.log(`[${ENV}] customers ~ "sin hua":`, JSON.stringify(custs, null, 2));
}
main().finally(() => p.$disconnect());
