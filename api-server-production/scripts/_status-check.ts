import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main(){
  const docs = await prisma.document.findMany({ where:{ organizationId:'d068f159-e45a-4da8-beaf-62e903f44141', type:'INVOICE' }, select:{ name:true, status:true, updatedAt:true }, orderBy:{ name:'asc' } });
  console.log(`count=${docs.length}`);
  docs.forEach((d:any)=>console.log(`  ${String(d.name).padEnd(16)} status=${JSON.stringify(d.status)}  updated=${d.updatedAt.toISOString()}`));
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
