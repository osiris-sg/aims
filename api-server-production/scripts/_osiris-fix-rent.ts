/**
 * guru 2026-09-15: EX100 is rent, not incubator fees.
 *   1. rename EX100 → "Rent of Premises"
 *   2. move the Ngee Ann Polytechnic rent payments out of CA001 Trade
 *      Receivables into EX100 — same landlord as Pollinate, the bank just
 *      changed the payee name around Aug 2025.
 * Lines are repointed in place so each stays on its original date and lands in
 * the right financial year (a lump reclass today would push FY2025 rent into
 * FY2026). These are machine-imported entries from the Aspire rebuild.
 * Dry / --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY=process.argv.includes('--apply');
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  console.log(`==== .env.production ${APPLY?'(APPLY)':'(DRY RUN)'} ====\n`);
  const ex100=await prisma.chartOfAccount.findFirst({where:{organizationId:ORG,code:'EX100'}});
  const ar=await prisma.chartOfAccount.findFirst({where:{organizationId:ORG,code:'CA001'}});
  console.log(`rename EX100: "${ex100!.name}" → "Rent of Premises"\n`);

  const moves=await prisma.journalEntryLine.findMany({
    where:{ accountId:ar!.id, debit:{gt:0}, description:{ contains:'Ngee Ann Polytechnic' },
            journalEntry:{ organizationId:ORG, status:'POSTED', type:'MANUAL' } },
    include:{ journalEntry:{ select:{ journalNumber:true, entryDate:true } } },
    orderBy:{ journalEntry:{ entryDate:'asc' } },
  });
  console.log(`move CA001 → EX100 (${moves.length} lines):`);
  let t=0, fy25=0;
  for(const l of moves as any[]){ t+=l.debit;
    const y=l.journalEntry.entryDate.getUTCFullYear(); if(y===2025) fy25+=l.debit;
    console.log(`  ${l.journalEntry.entryDate.toISOString().slice(0,10)} ${l.journalEntry.journalNumber} ${l.debit.toFixed(2).padStart(9)}  ${String(l.description).slice(0,52)}`); }
  console.log(`  ${''.padEnd(22)} ${t.toFixed(2).padStart(9)}   (FY2025 portion ${fy25.toFixed(2)})`);
  console.log(`\nleft alone in CA001: the 4 Asia Deal Hub card payments (163.57) — separate question`);

  if(!APPLY){ console.log('\n(dry run — nothing written)'); return; }
  await prisma.chartOfAccount.update({ where:{ id:ex100!.id }, data:{ name:'Rent of Premises',
    description:'Ngee Ann Polytechnic / Pollinate incubator space — rent ~1,242.60/month' }});
  for(const l of moves as any[]) await prisma.journalEntryLine.update({ where:{ id:l.id }, data:{ accountId:ex100!.id }});
  console.log(`\nrenamed EX100 and moved ${moves.length} lines totalling ${t.toFixed(2)}`);
})().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
