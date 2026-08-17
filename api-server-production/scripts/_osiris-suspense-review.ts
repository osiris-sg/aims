import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
async function main(){
  const acct = await prisma.chartOfAccount.findFirst({ where:{ organizationId:ORG, code:'CA900' } });
  const lines = await prisma.journalEntryLine.findMany({
    where:{ accountId:acct!.id, journalEntry:{ organizationId:ORG, status:'POSTED' } },
    include:{ journalEntry:{ select:{ entryDate:true, journalNumber:true, reference:true } } },
  });
  const rows = lines.map((l:any)=>({
    date:l.journalEntry.entryDate.toISOString().slice(0,10),
    jv:l.journalEntry.journalNumber,
    amount: l.debit>0 ? -l.debit : l.credit,   // negative = paid out
    who:(l.description||'').split(' — ')[0].trim(),
    detail:(l.description||'').split(' — ').slice(1).join(' — ').trim(),
    bankRef:l.journalEntry.reference||'',
  })).sort((a:any,b:any)=> a.who.localeCompare(b.who) || a.date.localeCompare(b.date));

  const byWho=new Map<string,{n:number;out:number;in:number}>();
  for(const r of rows){ const b=byWho.get(r.who)||{n:0,out:0,in:0}; b.n++; if(r.amount<0)b.out+=-r.amount; else b.in+=r.amount; byWho.set(r.who,b); }
  console.log(`CA900 suspense — ${rows.length} transactions across ${byWho.size} counterparties\n`);
  console.log(`${'counterparty'.padEnd(38)} ${'n'.padStart(4)} ${'paid out'.padStart(12)} ${'came in'.padStart(11)} ${'net'.padStart(12)}`);
  console.log('-'.repeat(82));
  let TO=0,TI=0;
  for(const [w,b] of [...byWho].sort((a,b)=>b[1].out-a[1].out)){
    TO+=b.out; TI+=b.in;
    console.log(`${w.slice(0,38).padEnd(38)} ${String(b.n).padStart(4)} ${b.out.toFixed(2).padStart(12)} ${b.in.toFixed(2).padStart(11)} ${(b.out-b.in).toFixed(2).padStart(12)}`);
  }
  console.log('-'.repeat(82));
  console.log(`${'TOTAL'.padEnd(38)} ${String(rows.length).padStart(4)} ${TO.toFixed(2).padStart(12)} ${TI.toFixed(2).padStart(11)} ${(TO-TI).toFixed(2).padStart(12)}`);

  const out = path.join(os.homedir(),'Downloads','osiris-suspense-review.csv');
  const esc=(s:any)=>`"${String(s??'').replace(/"/g,'""')}"`;
  fs.writeFileSync(out,
    ['Counterparty,Date,Amount,Direction,Detail,BankRef,JV,"Classify as (EX010 director / EX011 salary / CS003 contractor / CL020 drawings)"']
      .concat(rows.map((r:any)=>[esc(r.who),r.date,r.amount.toFixed(2),r.amount<0?'PAID OUT':'RECEIVED',esc(r.detail),esc(r.bankRef),r.jv,''].join(',')))
      .join('\n'));
  console.log(`\nwrote ${out}`);
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
