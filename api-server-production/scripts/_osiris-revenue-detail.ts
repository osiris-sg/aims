import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const FROM=new Date('2025-01-01T00:00:00Z'), TO=new Date('2025-12-31T23:59:59Z');
(async()=>{
  const accts=await prisma.chartOfAccount.findMany({where:{organizationId:ORG,accountType:{in:['SALES','INCOME']}},orderBy:{code:'asc'}});
  let grand=0;
  for(const a of accts as any[]){
    const lines=await prisma.journalEntryLine.findMany({
      where:{accountId:a.id, journalEntry:{organizationId:ORG,status:'POSTED',entryDate:{gte:FROM,lte:TO}}},
      include:{journalEntry:{select:{entryDate:true,reference:true,journalNumber:true}}},
      orderBy:{journalEntry:{entryDate:'asc'}},
    });
    if(!lines.length) continue;
    const tot=lines.reduce((s:number,l:any)=>s+l.credit-l.debit,0); grand+=tot;
    console.log(`\n── ${a.code} ${a.name} — ${tot.toLocaleString('en-SG',{minimumFractionDigits:2})} (${lines.length}) ──`);
    for(const l of lines as any[])
      console.log(`   ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${(l.credit-l.debit).toFixed(2).padStart(10)}  ${String(l.journalEntry.reference||'').padEnd(18)} ${String(l.description||'').slice(0,46)}`);
  }
  console.log(`\n   TOTAL TRADING INCOME FY2025: ${grand.toLocaleString('en-SG',{minimumFractionDigits:2})}`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
