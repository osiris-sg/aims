import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  const bank=await prisma.chartOfAccount.findFirst({where:{organizationId:ORG,code:'CA101'}});
  const lines=await prisma.journalEntryLine.findMany({
    where:{accountId:bank!.id, debit:{gte:2500,lte:3600}, journalEntry:{organizationId:ORG,status:'POSTED'}},
    include:{journalEntry:{select:{entryDate:true,journalNumber:true}}},
    orderBy:{journalEntry:{entryDate:'asc'}},
  });
  console.log(`money IN between 2,500 and 3,600 — ${lines.length} hits\n`);
  for(const l of lines as any[]){
    const tag = Math.abs(l.debit-3000)<0.005 ? '   <-- exactly 3,000' : '';
    console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.debit.toFixed(2).padStart(9)}  ${String(l.description||'').slice(0,56).padEnd(56)}${tag}`);
  }
  const last=await prisma.journalEntry.findFirst({where:{organizationId:ORG,type:'MANUAL'},orderBy:{entryDate:'desc'},select:{entryDate:true}});
  console.log(`\nbank data in AIMS runs to ${last?.entryDate.toISOString().slice(0,10)}`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
