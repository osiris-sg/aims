import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env.production';
const m = fs.readFileSync(envFile,'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
async function main(){
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG, type:'INVOICE' }, orderBy:{ name:'asc' } });
  console.log(`${docs.length} invoices in ${envFile}\n`);
  for(const d of docs){
    const c:any=d.config||{};
    console.log(`${d.name}  [${d.status}]  ${c.date||'?'}  ${c.customerName||'(no customer)'}  total=${c.nettTotal ?? '?'}`);
    console.log(`   referenceNo="${c.referenceNo??''}"  remarks="${(c.remarks??'').slice(0,40)}"  note="${(c.note??'').slice(0,40)}"  poNo="${c.poNo??''}"`);
    const items:any[]=c.items||[];
    items.slice(0,6).forEach((i:any)=>console.log(`      - ${String(i.description||'').slice(0,72)}  (${i.quantity} x ${i.unitPrice})`));
    if(items.length>6) console.log(`      ... +${items.length-6} more lines`);
    if(!items.length) console.log('      (no line items)');
    console.log();
  }
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
