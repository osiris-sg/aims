import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const f=(n:number)=>n.toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2}).padStart(14);
async function main(){
  const lines = await prisma.journalEntryLine.findMany({
    where:{ journalEntry:{ organizationId:ORG, status:'POSTED' } },
    include:{ account:{ select:{ code:true, name:true, category:true, accountType:true } } },
  });
  const bal=new Map<string,{name:string;cat:string;type:string;d:number;c:number}>();
  for(const l of lines as any[]){
    const k=l.account.code;
    const b=bal.get(k)||{name:l.account.name,cat:l.account.category,type:l.account.accountType,d:0,c:0};
    b.d+=l.debit; b.c+=l.credit; bal.set(k,b);
  }
  console.log('════════ TRIAL BALANCE (all posted) ════════');
  console.log(`${'code'.padEnd(7)} ${'account'.padEnd(38)} ${'debit'.padStart(14)} ${'credit'.padStart(14)}`);
  let TD=0,TC=0;
  for(const [c,b] of [...bal].sort()){
    const n=b.d-b.c; const dr=n>0?n:0, cr=n<0?-n:0; TD+=dr; TC+=cr;
    console.log(`${c.padEnd(7)} ${b.name.slice(0,38).padEnd(38)} ${dr?f(dr):''.padStart(14)} ${cr?f(cr):''.padStart(14)}`);
  }
  console.log(`${''.padEnd(46)} ${f(TD)} ${f(TC)}`);
  console.log(`balanced: ${Math.abs(TD-TC)<0.005?'YES ✓':'NO ✗ '+(TD-TC).toFixed(2)}\n`);

  const sum=(pred:(b:any)=>boolean)=>[...bal.values()].filter(pred).reduce((s,b)=>s+(b.c-b.d),0);
  const REV=['SALES','INCOME'], EXP=['EXPENSE','PURCHASE','TAX','EXCHANGE_GAIN_LOSS'];
  const revenue=sum(b=>REV.includes(b.type));
  const expenses=-sum(b=>EXP.includes(b.type));
  console.log('════════ PROFIT & LOSS ════════');
  for(const [c,b] of [...bal].sort()) if(REV.includes(b.type)) console.log(`  ${c.padEnd(7)} ${b.name.slice(0,38).padEnd(38)} ${f(b.c-b.d)}`);
  console.log(`  ${'REVENUE'.padEnd(46)} ${f(revenue)}`);
  for(const [c,b] of [...bal].sort()) if(EXP.includes(b.type)) console.log(`  ${c.padEnd(7)} ${b.name.slice(0,38).padEnd(38)} ${f(b.d-b.c)}`);
  console.log(`  ${'EXPENSES'.padEnd(46)} ${f(expenses)}`);
  console.log(`  ${'NET PROFIT / (LOSS)'.padEnd(46)} ${f(revenue-expenses)}\n`);

  console.log('════════ BALANCE SHEET ════════');
  let assets=0,liab=0;
  for(const [c,b] of [...bal].sort()){
    if(b.cat!=='BALANCE_SHEET') continue;
    const n=b.d-b.c;
    if(n>=0) assets+=n; else liab+=-n;
    console.log(`  ${c.padEnd(7)} ${b.name.slice(0,38).padEnd(38)} ${f(n)}`);
  }
  console.log(`  ${'NET ASSETS'.padEnd(46)} ${f(assets-liab)}`);
  console.log(`  ${'retained profit / (loss) for period'.padEnd(46)} ${f(revenue-expenses)}`);
  console.log(`  check: net assets = P&L result → ${Math.abs((assets-liab)-(revenue-expenses))<0.005?'✓ TIES':'✗ out by '+((assets-liab)-(revenue-expenses)).toFixed(2)}`);
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
