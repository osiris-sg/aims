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
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG, type:'INVOICE' }, select:{ name:true, status:true, config:true } });
  const jes = await prisma.journalEntry.findMany({
    where:{ organizationId:ORG, type:'INVOICE', status:'POSTED' },
    select:{ journalNumber:true, reference:true, totalDebit:true, entryDate:true },
  });
  const rev = await prisma.journalEntry.findMany({ where:{ organizationId:ORG, type:'ADJUSTMENT', status:'POSTED' }, select:{ reference:true, totalDebit:true } });
  const reversedAmt = rev.reduce((s:number,r:any)=>s+r.totalDebit,0);
  console.log(`${'invoice'.padEnd(16)} ${'doc total'.padStart(10)} ${'posts'.padStart(6)} ${'posted total'.padStart(13)} ${'over-posted'.padStart(12)}`);
  console.log('-'.repeat(64));
  let over=0;
  for(const d of docs as any[]){
    const mine = jes.filter((j:any)=>String(j.reference||'').includes(d.name));
    if(!mine.length) continue;
    const t = mine.reduce((s:number,j:any)=>s+j.totalDebit,0);
    const doc = Number(d.config?.nettTotal||0);
    const diff = t-doc;
    if(Math.abs(diff)>0.005) over+=diff;
    console.log(`${String(d.name).padEnd(16)} ${doc.toFixed(2).padStart(10)} ${String(mine.length).padStart(6)} ${t.toFixed(2).padStart(13)} ${Math.abs(diff)>0.005?diff.toFixed(2).padStart(12):''.padStart(12)}`);
  }
  console.log('-'.repeat(64));
  console.log(`gross over-posting (before reversals): ${over.toFixed(2)}`);
  console.log(`reversal entries: ${rev.length} totalling ${reversedAmt.toFixed(2)}`);
  console.log(`NET revenue overstatement: ${(over-reversedAmt).toFixed(2)}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
