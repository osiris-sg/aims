import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const f=(n:number)=>n.toFixed(2).padStart(10);
async function main(){
  const accts = await prisma.chartOfAccount.findMany({ where:{ organizationId:ORG, code:{ in:['CS004','EX020'] } } });
  const ids = new Map(accts.map((a:any)=>[a.id,a.code]));
  const lines = await prisma.journalEntryLine.findMany({
    where:{ accountId:{ in:[...ids.keys()] }, journalEntry:{ organizationId:ORG, status:'POSTED' } },
    include:{ journalEntry:{ select:{ entryDate:true } } },
  });
  const mon=new Map<string,{cloud:number;soft:number}>();
  const vendor=new Map<string,{n:number;t:number}>();
  for(const l of lines as any[]){
    const k=l.journalEntry.entryDate.toISOString().slice(0,7);
    const net=l.debit-l.credit;               // refunds credit back
    const b=mon.get(k)||{cloud:0,soft:0}; 
    if(ids.get(l.accountId)==='CS004') b.cloud+=net; else b.soft+=net;
    mon.set(k,b);
    if(ids.get(l.accountId)==='CS004'){
      const name=String(l.description||'').split(/\s{2,}|\s+\+?\d{6,}|\s+—/)[0].trim().slice(0,26).toUpperCase();
      const v=vendor.get(name)||{n:0,t:0}; v.n++; v.t+=net; vendor.set(name,v);
    }
  }
  const keys=[...mon.keys()].sort();
  console.log(`${'month'.padEnd(9)} ${'cloud/server'.padStart(10)} ${'software'.padStart(10)} ${'total tech'.padStart(11)}`);
  console.log('-'.repeat(44));
  let tc=0,ts=0;
  for(const k of keys){ const b=mon.get(k)!; tc+=b.cloud; ts+=b.soft;
    console.log(`${k.padEnd(9)} ${f(b.cloud)} ${f(b.soft)} ${(b.cloud+b.soft).toFixed(2).padStart(11)}`); }
  console.log('-'.repeat(44));
  const n=keys.length;
  console.log(`${'TOTAL'.padEnd(9)} ${f(tc)} ${f(ts)} ${(tc+ts).toFixed(2).padStart(11)}`);
  console.log(`${('AVG /mo ('+n+')').padEnd(9)} ${f(tc/n)} ${f(ts/n)} ${((tc+ts)/n).toFixed(2).padStart(11)}`);
  const last12=keys.slice(-12), l12=last12.reduce((s,k)=>s+mon.get(k)!.cloud,0), s12=last12.reduce((s,k)=>s+mon.get(k)!.soft,0);
  console.log(`${'AVG last12'.padEnd(9)} ${f(l12/12)} ${f(s12/12)} ${((l12+s12)/12).toFixed(2).padStart(11)}`);
  const last6=keys.slice(-6), l6=last6.reduce((s,k)=>s+mon.get(k)!.cloud,0), s6=last6.reduce((s,k)=>s+mon.get(k)!.soft,0);
  console.log(`${'AVG last6'.padEnd(9)} ${f(l6/6)} ${f(s6/6)} ${((l6+s6)/6).toFixed(2).padStart(11)}`);
  console.log(`\n=== cloud/server by vendor ===`);
  for(const [v,d] of [...vendor].sort((a,b)=>b[1].t-a[1].t).slice(0,16))
    console.log(`  ${v.padEnd(28)} ${String(d.n).padStart(4)} charges ${d.t.toFixed(2).padStart(10)}   avg/mo ${(d.t/n).toFixed(2).padStart(7)}`);
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
