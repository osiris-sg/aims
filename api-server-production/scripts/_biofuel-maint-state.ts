import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  const docs=await prisma.document.findMany({where:{organizationId:ORG,type:'INVOICE'},orderBy:{name:'asc'}});
  console.log('Osiris invoices:\n');
  for(const d of docs as any[]){
    const c:any=d.config||{};
    const items=(c.items||[]).map((i:any)=>String(i.description).replace(/<[^>]*>/g,'').slice(0,46)).join(' | ');
    console.log(`  ${String(d.name).padEnd(15)} ${String(d.status).padEnd(16)} ${String(c.nettTotal).padStart(9)}  ${String(c.customerName||'').slice(0,22).padEnd(22)} ${items.slice(0,70)}`);
  }
  const biofuel=await prisma.customer.findFirst({where:{organizationId:ORG,name:{contains:'Biofuel',mode:'insensitive'}}});
  console.log(`\nBiofuel customer: ${biofuel?.id} | ${biofuel?.name}`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
