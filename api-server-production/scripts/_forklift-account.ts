import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const doc = await p.document.findFirst({ where: { organizationId: ORG, name: 'BI2026080116' }, select: { config: true } });
  const items: any[] = (doc?.config as any)?.items || [];
  console.log('seed invoice items:', JSON.stringify(items.map((i: any) => ({ desc: (i.description||'').slice(0,40), itemCode: i.itemCode, accountCode: i.accountCode, accountId: i.accountId, inventoryItemId: i.inventoryItemId, isService: i.isService })), null, 1));
  const forklift = await p.asset.findMany({ where: { organizationId: ORG, name: { contains: 'orklift' } }, take: 3 });
  for (const a of forklift) console.log('asset full:', JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k,v]) => v !== null && v !== undefined && k !== 'description')), null, 0).slice(0, 600));
  const rev = await p.revenueItem?.findMany?.({ where: { organizationId: ORG, name: { contains: 'orklift' } }, take: 3 }).catch(() => []);
  console.log('revenueItems:', JSON.stringify(rev));
}
main().finally(() => p.$disconnect());
