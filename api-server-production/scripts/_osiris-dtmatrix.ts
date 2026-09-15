import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  const lines=await prisma.journalEntryLine.findMany({
    where:{ description:{ contains:'DTMATRIX', mode:'insensitive' }, journalEntry:{ organizationId:ORG, status:'POSTED' } },
    include:{ account:{select:{code:true,name:true}}, journalEntry:{select:{entryDate:true,journalNumber:true,type:true,reference:true}} },
    orderBy:{ journalEntry:{ entryDate:'asc' } },
  });
  console.log(`DT Matrix in the ledger — ${lines.length} lines\n`);
  for(const l of lines as any[])
    console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.journalEntry.journalNumber} ${String(l.journalEntry.type).padEnd(8)} ${l.account.code} ${l.account.name.slice(0,28).padEnd(28)} Dr ${l.debit.toFixed(2).padStart(9)} Cr ${l.credit.toFixed(2).padStart(9)}`);
  // the invoice side
  const inv=await prisma.journalEntryLine.findMany({
    where:{ journalEntry:{ organizationId:ORG, status:'POSTED', reference:{ contains:'INV-057' } } },
    include:{ account:{select:{code:true,name:true}}, journalEntry:{select:{entryDate:true,journalNumber:true,description:true}} },
  });
  console.log(`\nINV-057 postings:`);
  inv.forEach((l:any)=>console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.journalEntry.journalNumber} ${l.account.code} ${l.account.name.slice(0,30).padEnd(30)} Dr ${l.debit.toFixed(2)} Cr ${l.credit.toFixed(2)}  | ${l.journalEntry.description}`));
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
