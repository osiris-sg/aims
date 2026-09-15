import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  const ar=await prisma.chartOfAccount.findFirst({where:{organizationId:ORG,code:'CA001'}});
  const lines=await prisma.journalEntryLine.findMany({
    where:{accountId:ar!.id, debit:{gt:0}, journalEntry:{organizationId:ORG,status:'POSTED'}},
    include:{journalEntry:{select:{journalNumber:true,entryDate:true,type:true}}},
    orderBy:{journalEntry:{entryDate:'asc'}},
  });
  const pay=lines.filter((l:any)=>l.journalEntry.type==='MANUAL');
  console.log(`payments OUT that were booked against Trade Receivables — ${pay.length}\n`);
  let t=0;
  for(const l of pay as any[]){ t+=l.debit;
    console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.debit.toFixed(2).padStart(9)}  ${String(l.description||'').slice(0,64)}`); }
  console.log(`  ${''.padEnd(11)} ${t.toFixed(2).padStart(9)}  ← these are NOT customer refunds; they reduce AR wrongly`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
