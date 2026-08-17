import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main(){
  const docs = await prisma.document.findMany({ where:{ type:{in:['INVOICE','QUOTATION']} }, select:{ name:true, config:true }, take:4000 });
  let withAcct=0, withoutAcct=0; const ex:string[]=[];
  for(const d of docs as any[]) for(const it of ((d.config?.items)||[])){
    if(!String(it.itemCode||'').toUpperCase().startsWith('SV')) continue;
    if(it.accountCode) withAcct++; else { withoutAcct++; if(ex.length<6) ex.push(`${d.name} ${it.itemCode} keys=[${Object.keys(it).join(',')}]`); }
  }
  console.log(`SV lines WITH accountCode:    ${withAcct}`);
  console.log(`SV lines WITHOUT accountCode: ${withoutAcct}`);
  ex.forEach(e=>console.log('  '+e));
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
