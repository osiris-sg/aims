import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
async function main() {
  const imps = await p.bankStatementImport.findMany({ orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, filename: true, status: true, error: true, createdAt: true, _count: { select: { lines: true } } } });
  for (const i of imps) console.log(JSON.stringify(i));
}
main().finally(() => p.$disconnect());
