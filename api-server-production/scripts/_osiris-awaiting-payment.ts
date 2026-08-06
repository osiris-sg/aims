/**
 * Move confirmed Osiris invoices to pending_payment ("Awaiting payment").
 * Excludes TI2202605-001 (test data, 5.45) — junk, shouldn't sit in AR.
 * Dry / --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
const SKIP=['TI2202605-001']; // test data
async function main(){
  console.log(`==== .env.production ${APPLY?'(APPLY)':'(DRY RUN)'} ====\n`);
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG, type:'INVOICE', status:'confirmed' }, orderBy:{ name:'asc' } });
  let n=0;
  for(const d of docs as any[]){
    const c:any=d.config||{};
    if(SKIP.includes(d.name)){ console.log(`  SKIP    ${d.name}  ${c.nettTotal}  (test data)`); continue; }
    console.log(`  →AWAIT  ${d.name}  ${String(c.nettTotal).padStart(9)}  ${c.customerName||'(no customer)'}`);
    if(APPLY){ await prisma.document.update({ where:{id:d.id}, data:{ status:'pending_payment' } }); n++; }
  }
  console.log(APPLY?`\nmoved ${n} to pending_payment`:'\n(dry run)');
}
main().catch(e=>console.error(e)).finally(()=>prisma.$disconnect());
