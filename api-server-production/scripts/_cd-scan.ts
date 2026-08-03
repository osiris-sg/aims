import * as dotenv from 'dotenv';
import * as path from 'path';
const ENV = process.argv[2] || 'dev';
const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const rows = await p.chartOfAccount.findMany({
    where: { organizationId: BIOFUEL, code: { startsWith: 'CD' } },
    orderBy: { code: 'asc' },
  });
  console.log(`[${ENV}]`);
  for (const r of rows) console.log(' ', JSON.stringify(r));
}
main().finally(() => p.$disconnect());
