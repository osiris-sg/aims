import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const FROM=new Date('2025-01-01T00:00:00Z'), TO=new Date('2025-12-31T23:59:59Z');
const f=(n:number)=>n.toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2}).padStart(13);
async function main(){
  const bank = await prisma.chartOfAccount.findFirst({ where:{ organizationId:ORG, code:'CA101' } });
  const lines = await prisma.journalEntryLine.findMany({
    where:{ journalEntry:{ organizationId:ORG, status:'POSTED', entryDate:{ gte:FROM, lte:TO } } },
    include:{ account:{ select:{ code:true,name:true,accountType:true,category:true } },
              journalEntry:{ select:{ journalNumber:true, entryDate:true, type:true, reference:true, description:true } } },
    orderBy:{ journalEntry:{ entryDate:'asc' } },
  });
  const jns=new Set(lines.map((l:any)=>l.journalEntry.journalNumber));
  console.log(`FY2025 (1 Jan – 31 Dec 2025): ${jns.size} journal entries, ${lines.length} lines\n`);

  // bank movement + opening/closing
  const before = await prisma.journalEntryLine.aggregate({
    where:{ accountId:bank!.id, journalEntry:{ organizationId:ORG, status:'POSTED', entryDate:{ lt:FROM } } },
    _sum:{ debit:true, credit:true } });
  const open=(before._sum.debit||0)-(before._sum.credit||0);
  const inY=lines.filter((l:any)=>l.accountId===bank!.id);
  const bIn=inY.reduce((s:number,l:any)=>s+l.debit,0), bOut=inY.reduce((s:number,l:any)=>s+l.credit,0);
  console.log(`bank opening 1 Jan 2025   ${f(open)}`);
  console.log(`  money in                ${f(bIn)}`);
  console.log(`  money out               ${f(bOut)}`);
  console.log(`bank closing 31 Dec 2025  ${f(open+bIn-bOut)}   (${inY.length} bank transactions)\n`);

  const REV=['SALES','INCOME'], EXP=['EXPENSE','PURCHASE','TAX','EXCHANGE_GAIN_LOSS'];
  const acc=new Map<string,{name:string;t:string;n:number;v:number}>();
  for(const l of lines as any[]){
    const a=acc.get(l.account.code)||{name:l.account.name,t:l.account.accountType,n:0,v:0};
    a.n++; a.v += REV.includes(l.account.accountType) ? (l.credit-l.debit) : (l.debit-l.credit);
    acc.set(l.account.code,a);
  }
  const show=(title:string,pred:(t:string)=>boolean)=>{
    console.log(`── ${title} ──`);
    let tot=0;
    for(const [c,a] of [...acc].sort()) if(pred(a.t)){ tot+=a.v; console.log(`  ${c.padEnd(7)} ${a.name.slice(0,38).padEnd(38)} ${String(a.n).padStart(4)} ${f(a.v)}`); }
    console.log(`  ${''.padEnd(50)} ${f(tot)}\n`); return tot;
  };
  const rev=show('REVENUE',(t)=>REV.includes(t));
  const exp=show('EXPENSES (classified)',(t)=>EXP.includes(t));
  const susp=acc.get('CA900')?.v||0;
  console.log(`PROFIT as posted                       ${f(rev-exp)}`);
  console.log(`still unclassified in suspense         ${f(susp)}`);
  console.log(`PROFIT if all suspense is expense      ${f(rev-exp-susp)}\n`);

  const esc=(s:any)=>`"${String(s??'').replace(/"/g,'""')}"`;
  const out=path.join(os.homedir(),'Downloads','osiris-FY2025-transactions.csv');
  fs.writeFileSync(out,['Date,JV,Type,Reference,Description,Account,"Account name",Debit,Credit',
    ...lines.map((l:any)=>[l.journalEntry.entryDate.toISOString().slice(0,10),l.journalEntry.journalNumber,
      l.journalEntry.type,esc(l.journalEntry.reference),esc(l.description||l.journalEntry.description),
      l.account.code,esc(l.account.name),l.debit.toFixed(2),l.credit.toFixed(2)].join(','))].join('\n'));
  console.log(`wrote ${out}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
