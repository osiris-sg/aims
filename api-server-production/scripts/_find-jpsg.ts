import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const strip=(s:any)=>String(s||'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
(async()=>{
  const docs=await prisma.document.findMany({where:{organizationId:ORG},orderBy:{name:'asc'}});
  console.log('Osiris docs mentioning JPSG / Jurong:\n');
  for(const d of docs as any[]){
    const c:any=d.config||{};
    const blob=[c.referenceNo,...(c.items||[]).map((i:any)=>i.description)].map(strip).join(' | ');
    if(/jpsg|jurong/i.test(blob))
      console.log(`  ${String(d.name).padEnd(15)} ${String(d.type).padEnd(9)} ${String(d.status).padEnd(15)} ${String(c.nettTotal).padStart(9)}  ${blob.slice(0,90)}`);
  }
  console.log('\nOsiris INVOICES between 1,500 and 2,500:');
  for(const d of docs as any[]){
    const c:any=d.config||{}; const t=Number(c.nettTotal||0);
    if(d.type==='INVOICE' && t>=1500 && t<=2500)
      console.log(`  ${String(d.name).padEnd(15)} ${String(d.status).padEnd(15)} ${t.toFixed(2).padStart(9)}  ${strip(c.customerName)} | ${(c.items||[]).map((i:any)=>strip(i.description)).join(' | ').slice(0,60)}`);
  }
  // any 2,000 line item anywhere
  console.log('\nany Osiris line item of exactly 2,000:');
  for(const d of docs as any[]) for(const i of (((d.config as any)?.items)||[]))
    if(Math.abs(Number(i.amount||0)-2000)<0.005) console.log(`  ${d.name} [${d.status}] ${strip(i.description).slice(0,70)}`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
