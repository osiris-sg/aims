import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env.production';
const m = fs.readFileSync(envFile,'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main(){
  console.log(`==== ${envFile} ====`);
  const revs = await prisma.revenueItem.findMany({ where:{ code:{ startsWith:'SV' } }, orderBy:{ code:'asc' } });
  console.log(`RevenueItems with SV* code: ${revs.length}`);
  revs.forEach((r:any)=>console.log(`  ${String(r.code).padEnd(8)} type=${JSON.stringify(r.type).padEnd(11)} acct=${r.accountCode}  org=${r.organizationId.slice(0,8)}  ${String(r.name).slice(0,42)}`));
  const types = await prisma.revenueItem.groupBy({ by:['type'], _count:{_all:true} });
  console.log('\nall RevenueItem types:', types.map((t:any)=>`${JSON.stringify(t.type)}=${t._count._all}`).join(' '));
  // find documents carrying an SV-coded line and report isService on it
  const docs = await prisma.document.findMany({ where:{ type:{ in:['INVOICE','QUOTATION'] } }, select:{ id:true,name:true,organizationId:true,config:true }, take:4000 });
  let svLines=0, svMissingFlag=0; const examples:string[]=[];
  for(const d of docs as any[]){
    for(const it of ((d.config?.items)||[])){
      if(String(it.itemCode||'').toUpperCase().startsWith('SV')){
        svLines++;
        if(!it.isService){ svMissingFlag++; if(examples.length<12) examples.push(`${d.name} | ${it.itemCode} | isService=${JSON.stringify(it.isService)} | revenueTag=${JSON.stringify(it.revenueTag)}`); }
      }
    }
  }
  console.log(`\nSV-coded document lines scanned: ${svLines}`);
  console.log(`  of those MISSING isService=true: ${svMissingFlag}`);
  examples.forEach(e=>console.log(`    ${e}`));
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
