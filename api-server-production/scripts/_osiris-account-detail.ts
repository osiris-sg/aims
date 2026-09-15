import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const code=process.argv[2]||'EX100';
const from=new Date(process.argv[3]||'2025-01-01'), to=new Date((process.argv[4]||'2025-12-31')+'T23:59:59Z');
(async()=>{
  const a=await prisma.chartOfAccount.findFirst({where:{organizationId:ORG,code}});
  const lines=await prisma.journalEntryLine.findMany({
    where:{accountId:a!.id, journalEntry:{organizationId:ORG,status:'POSTED',entryDate:{gte:from,lte:to}}},
    include:{journalEntry:{select:{journalNumber:true,entryDate:true,reference:true}}},
    orderBy:{journalEntry:{entryDate:'asc'}},
  });
  console.log(`${code} ${a!.name} — ${from.toISOString().slice(0,10)} to ${to.toISOString().slice(0,10)}\n`);
  let t=0;
  for(const l of lines as any[]){ const v=l.debit-l.credit; t+=v;
    console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.journalEntry.journalNumber} ${v.toFixed(2).padStart(10)}  ${String(l.description||'').slice(0,62)}`); }
  console.log(`  ${''.padEnd(22)} ${t.toFixed(2).padStart(10)}  (${lines.length} transactions)`);
  // all time for this account
  const all=await prisma.journalEntryLine.aggregate({where:{accountId:a!.id,journalEntry:{organizationId:ORG,status:'POSTED'}},_sum:{debit:true,credit:true},_count:{_all:true}});
  console.log(`\n  all time: ${((all._sum.debit||0)-(all._sum.credit||0)).toFixed(2)} across ${all._count._all} transactions`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
