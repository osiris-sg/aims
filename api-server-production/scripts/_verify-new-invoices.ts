import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main(){
  const docs = await prisma.document.findMany({
    where:{ organizationId:'d068f159-e45a-4da8-beaf-62e903f44141', name:{ startsWith:'TI2202608' } },
    orderBy:{ name:'asc' },
  });
  for(const d of docs){
    const c:any=d.config;
    console.log(`\n${d.name}  [${d.status}]  ${c.date}  ${c.customerName}`);
    c.items.forEach((i:any)=>console.log(`   ${i.description.padEnd(34)} ${String(i.quantity).padStart(4)} x ${i.unitPrice.toFixed(2)} = ${i.amount.toFixed(2).padStart(9)}`));
    console.log(`   subTotal=${c.subTotal}  gst=${c.gstAmount}  nettTotal=${c.nettTotal}  taxApplicable=${c.taxApplicable}`);
  }
  console.log(`\ntotal billed: ${docs.reduce((s:number,d:any)=>s+(d.config.nettTotal||0),0).toFixed(2)}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
