import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  const d=await prisma.document.findFirst({where:{organizationId:ORG,name:'TI2202605-003'}});
  const c:any=d!.config;
  console.log(`TI2202605-003  [${d!.status}]  created ${d!.createdAt.toISOString().slice(0,10)}  dated ${c.date}`);
  console.log(`  customer: "${c.customerName||''}" (id ${c.customerId||'none'})   total ${c.nettTotal}`);
  console.log(`  reference: "${c.referenceNo||''}"`);
  (c.items||[]).forEach((i:any)=>console.log(`   item: ${String(i.description).replace(/<[^>]*>/g,'').slice(0,60)}  ${i.quantity} x ${i.unitPrice} = ${i.amount}`));
  const je=await prisma.journalEntry.findMany({where:{organizationId:ORG,reference:{contains:'TI2202605-003'}},
    select:{journalNumber:true,status:true,totalDebit:true,entryDate:true}});
  console.log(`\n  journals: ${je.map((j:any)=>`${j.journalNumber}[${j.status}] ${j.totalDebit}`).join(', ')}`);
  // matching Google Cloud cost in the bank?
  const gc=await prisma.journalEntryLine.findMany({
    where:{ description:{ contains:'Google', mode:'insensitive' }, journalEntry:{ organizationId:ORG, status:'POSTED', type:'MANUAL' } },
    include:{ account:{select:{code:true}}, journalEntry:{select:{entryDate:true}} },
    orderBy:{ journalEntry:{ entryDate:'asc' } },
  });
  const cloud=gc.filter((l:any)=>/CLOUD/i.test(String(l.description)) && l.debit>0);
  console.log(`\n  Google Cloud payments in the bank (${cloud.length}):`);
  cloud.forEach((l:any)=>console.log(`    ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.debit.toFixed(2).padStart(9)} ${l.account.code}  ${String(l.description).slice(0,50)}`));
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
