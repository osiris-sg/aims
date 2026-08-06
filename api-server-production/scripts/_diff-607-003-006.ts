import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const strip=(s:string)=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
async function main(){
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG, name:{ in:['TI2202607-003','TI2202607-006'] } } });
  const map = new Map<string, any[]>();
  for(const d of docs){ map.set(d.name!, ((d.config as any).items||[]).map((i:any)=>({d:strip(i.description),q:i.quantity,u:i.unitPrice,a:i.amount}))); }
  const A=map.get('TI2202607-003')!, B=map.get('TI2202607-006')!;
  const key=(i:any)=>`${i.d}|${i.q}|${i.u}`;
  const setA=new Set(A.map(key)), setB=new Set(B.map(key));
  const both=[...setA].filter(k=>setB.has(k));
  console.log(`TI2202607-003 (confirmed): ${A.length} lines, total ${A.reduce((s,i)=>s+i.a,0).toFixed(2)}`);
  console.log(`TI2202607-006 (unconfirmed): ${B.length} lines, total ${B.reduce((s,i)=>s+i.a,0).toFixed(2)}`);
  console.log(`\nIDENTICAL lines present in BOTH: ${both.length}`);
  both.forEach(k=>console.log(`   = ${k.split('|')[0].slice(0,64)}`));
  console.log(`\nONLY in 006 (the unconfirmed one):`);
  B.filter(i=>!setA.has(key(i))).forEach(i=>console.log(`   + ${i.d.slice(0,60)}  ${i.q} x ${i.u} = ${i.a}`));
  console.log(`\nONLY in 003 (already confirmed & billed):`);
  A.filter(i=>!setB.has(key(i))).forEach(i=>console.log(`   - ${i.d.slice(0,60)}  ${i.q} x ${i.u} = ${i.a}`));
  const dupVal=A.filter(i=>setB.has(key(i))).reduce((s,i)=>s+i.a,0);
  console.log(`\nValue of overlapping lines: ${dupVal.toFixed(2)}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
