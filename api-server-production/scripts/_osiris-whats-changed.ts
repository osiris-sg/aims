import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
async function main(){
  const je = await prisma.journalEntry.groupBy({ by:['status'], where:{ organizationId:ORG }, _count:{_all:true} });
  console.log('journal entries:', je.map((s:any)=>`${s.status}=${s._count._all}`).join(' '));
  const cut = new Date('2026-08-18T00:00:00Z');
  const since = await prisma.journalEntry.findMany({
    where:{ organizationId:ORG, createdAt:{ gte:cut } },
    select:{ journalNumber:true, entryDate:true, type:true, reference:true, description:true, totalDebit:true, createdBy:true, createdAt:true },
    orderBy:{ createdAt:'asc' },
  });
  console.log(`\njournals created since 18 Aug: ${since.length}`);
  since.slice(0,25).forEach((j:any)=>console.log(`  ${j.journalNumber} ${j.entryDate.toISOString().slice(0,10)} ${String(j.type).padEnd(10)} ${String(j.reference||'').padEnd(16)} ${j.totalDebit.toFixed(2).padStart(10)}  by=${j.createdBy}`));
  if(since.length>25) console.log(`  … +${since.length-25} more`);
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG, type:'INVOICE' }, select:{ name:true, status:true, config:true, createdAt:true }, orderBy:{ name:'asc' } });
  console.log(`\ninvoices in Osiris: ${docs.length}`);
  docs.forEach((d:any)=>console.log(`  ${String(d.name).padEnd(16)} ${String(d.status).padEnd(16)} ${String(d.config?.nettTotal ?? 0).padStart(10)}  created ${d.createdAt.toISOString().slice(0,10)}`));
  const ri = await prisma.revenueItem.count({ where:{ organizationId:ORG } });
  const coa = await prisma.chartOfAccount.count({ where:{ organizationId:ORG } });
  console.log(`\nchart of accounts: ${coa} | revenue items: ${ri}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
