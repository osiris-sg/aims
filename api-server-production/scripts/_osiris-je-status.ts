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
  for(const ref of ['TI2202608-006','TI2202608-005','TI2202608-004','TI2202608-003']){
    const jes = await prisma.journalEntry.findMany({
      where:{ organizationId:ORG, reference:{ contains:ref } },
      select:{ journalNumber:true, type:true, status:true, totalDebit:true, isUnconfirmed:true, reversesEntryId:true },
      orderBy:{ journalNumber:'asc' },
    });
    const posted=jes.filter((j:any)=>j.status==='POSTED');
    console.log(`\n${ref} — ${jes.length} journals (${posted.length} POSTED)`);
    jes.forEach((j:any)=>console.log(`   ${j.journalNumber} ${String(j.type).padEnd(10)} ${String(j.status).padEnd(7)} ${j.totalDebit.toFixed(2).padStart(10)} unconfirmed=${j.isUnconfirmed} ${j.reversesEntryId?'(reversal)':''}`));
    const net=posted.reduce((s:number,j:any)=>s+(j.reversesEntryId? -j.totalDebit : j.totalDebit),0);
    console.log(`   → net posted effect: ${net.toFixed(2)}`);
  }
  const all = await prisma.journalEntry.groupBy({ by:['status','type'], where:{ organizationId:ORG }, _count:{_all:true}, _sum:{ totalDebit:true } });
  console.log('\n=== all Osiris journals by status/type ===');
  all.forEach((a:any)=>console.log(`  ${String(a.status).padEnd(8)} ${String(a.type).padEnd(12)} n=${String(a._count._all).padStart(4)} total=${(a._sum.totalDebit||0).toFixed(2).padStart(12)}`));
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
