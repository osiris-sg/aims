import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const strip=(s:any)=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
async function show(names:string[], title:string){
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG, name:{ in:names } }, orderBy:{ name:'asc' } });
  console.log(`\n${'═'.repeat(96)}\n${title}\n${'═'.repeat(96)}`);
  const sets:Record<string,any[]>={};
  for(const d of docs as any[]){
    const c:any=d.config||{};
    const items=(c.items||[]).map((i:any)=>({d:strip(i.description),q:i.quantity,u:i.unitPrice,a:i.amount}));
    sets[d.name]=items;
    console.log(`\n▸ ${d.name}  [${d.status}]  dated ${c.date}  —  TOTAL ${Number(c.nettTotal).toFixed(2)}   (${items.length} lines)`);
    console.log(`  ref: "${c.referenceNo||''}"`);
    items.forEach((i:any,n:number)=>console.log(`   ${String(n+1).padStart(2)}. ${i.d.slice(0,62).padEnd(62)} ${String(i.q).padStart(5)} x ${Number(i.u).toFixed(2).padStart(9)} = ${Number(i.a).toFixed(2).padStart(10)}`));
  }
  if(names.length===2 && sets[names[0]] && sets[names[1]]){
    const [A,B]=[sets[names[0]],sets[names[1]]];
    const key=(i:any)=>`${i.d}|${i.q}|${i.u}`;
    const sA=new Set(A.map(key)), sB=new Set(B.map(key));
    const shared=A.filter(i=>sB.has(key(i)));
    console.log(`\n  → identical on both: ${shared.length} lines worth ${shared.reduce((s,i)=>s+i.a,0).toFixed(2)}`);
    const onlyB=B.filter(i=>!sA.has(key(i)));
    const onlyA=A.filter(i=>!sB.has(key(i)));
    if(onlyA.length){ console.log(`  → only on ${names[0]}:`); onlyA.forEach(i=>console.log(`       ${i.d.slice(0,58)}  ${i.q} x ${i.u} = ${i.a}`)); }
    if(onlyB.length){ console.log(`  → only on ${names[1]}:`); onlyB.forEach(i=>console.log(`       ${i.d.slice(0,58)}  ${i.q} x ${i.u} = ${i.a}`)); }
  }
}
async function main(){
  await show(['TI2202607-003','TI2202607-006'],'CASE 1 — TI2202607-003 (unpaid) vs TI2202607-006 (PAID 5 Aug, part of 57,063.28)');
  await show(['TI2202608-002','TI2202608-003'],'CASE 2 — TI2202608-002 (issued, awaiting payment) vs TI2202608-003 (unconfirmed)');
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
