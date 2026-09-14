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
  const revs = await prisma.journalEntry.findMany({
    where:{ organizationId:ORG, type:'ADJUSTMENT', reversesEntryId:{ not:null } },
    select:{ id:true, journalNumber:true, status:true, totalDebit:true, reversesEntryId:true, description:true },
    orderBy:{ journalNumber:'asc' },
  });
  console.log('reversal entries and the state of what they reverse:\n');
  for(const r of revs as any[]){
    const orig = await prisma.journalEntry.findUnique({ where:{ id:r.reversesEntryId }, select:{ journalNumber:true, status:true, totalDebit:true } });
    const bad = r.status==='POSTED' && orig?.status==='VOID';
    console.log(`  ${r.journalNumber} [${r.status.padEnd(6)}] ${r.totalDebit.toFixed(2).padStart(9)} reverses ${orig?.journalNumber} [${orig?.status}] ${bad?'  ← DOUBLE-REMOVAL: original already VOID':''}`);
  }
  const bad = [] as any[];
  for(const r of revs as any[]){
    const orig = await prisma.journalEntry.findUnique({ where:{ id:r.reversesEntryId }, select:{ status:true } });
    if(r.status==='POSTED' && orig?.status==='VOID') bad.push(r);
  }
  console.log(`\nPOSTED reversals whose original is VOID: ${bad.length}, totalling ${bad.reduce((s,r)=>s+r.totalDebit,0).toFixed(2)}`);
  console.log('→ revenue and receivables are UNDERSTATED by that amount');
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
