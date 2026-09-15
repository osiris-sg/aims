import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const REV=['SALES','INCOME'], EXP=['EXPENSE','PURCHASE','TAX','EXCHANGE_GAIN_LOSS'];
const f=(n:number)=>n.toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2}).padStart(13);
async function main(){
  const st = await prisma.accountingSetting.findUnique({ where:{ organizationId:ORG } });
  console.log(`AIMS accounting settings say FYE = ${st?.fiscalYearEndDay}/${st?.fiscalYearEndMonth}\n`);
  const lines = await prisma.journalEntryLine.findMany({
    where:{ journalEntry:{ organizationId:ORG, status:'POSTED' } },
    include:{ account:{ select:{ code:true,name:true,accountType:true,category:true } }, journalEntry:{ select:{ entryDate:true } } },
  });
  // calendar-year FY (31 Dec), which is what AIMS is set to
  const fy=new Map<string,{rev:number;exp:number;susp:number}>();
  for(const l of lines as any[]){
    const y=String(l.journalEntry.entryDate.getUTCFullYear());
    const b=fy.get(y)||{rev:0,exp:0,susp:0};
    if(REV.includes(l.account.accountType)) b.rev+=l.credit-l.debit;
    else if(EXP.includes(l.account.accountType)) b.exp+=l.debit-l.credit;
    if(l.account.code==='CA900') b.susp+=l.debit-l.credit;
    fy.set(y,b);
  }
  console.log(`${'financial year'.padEnd(22)} ${'revenue'.padStart(13)} ${'expenses'.padStart(13)} ${'profit as posted'.padStart(17)} ${'in suspense'.padStart(13)}`);
  console.log('-'.repeat(84));
  for(const y of [...fy.keys()].sort()){
    const b=fy.get(y)!;
    const label = y==='2024' ? '2024 (from 31 Mar)' : y==='2026' ? '2026 (to 17 Aug, part)' : y;
    console.log(`${label.padEnd(22)} ${f(b.rev)} ${f(b.exp)} ${f(b.rev-b.exp)} ${f(b.susp)}`);
  }
  console.log('-'.repeat(84));
  const T=[...fy.values()].reduce((a,b)=>({rev:a.rev+b.rev,exp:a.exp+b.exp,susp:a.susp+b.susp}),{rev:0,exp:0,susp:0});
  console.log(`${'TOTAL since inception'.padEnd(22)} ${f(T.rev)} ${f(T.exp)} ${f(T.rev-T.exp)} ${f(T.susp)}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
