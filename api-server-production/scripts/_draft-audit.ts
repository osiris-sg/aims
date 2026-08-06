import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2];
const m = fs.readFileSync(envFile,'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main(){
  console.log(`\n==== ${envFile} ====`);
  const byStatus = await prisma.document.groupBy({ by:['status'], _count:{_all:true} });
  console.log('ALL ORGS by status:', byStatus.map((s:any)=>`${s.status}=${s._count._all}`).join(' '));
  const drafts = await prisma.document.findMany({
    where:{ status:'draft' },
    select:{ name:true, type:true, organizationId:true, createdAt:true, updatedAt:true },
    orderBy:{ createdAt:'desc' }, take:15,
  });
  console.log(`\nnewest 'draft' docs (any org): ${drafts.length}`);
  drafts.forEach((d:any)=>console.log(`  ${String(d.name).padEnd(20)} ${d.type.padEnd(14)} org=${d.organizationId.slice(0,8)} created=${d.createdAt.toISOString().slice(0,10)} updated=${d.updatedAt.toISOString().slice(0,10)}`));
  const total = await prisma.document.count({ where:{ status:'draft' } });
  console.log(`total drafts across all orgs: ${total}`);
  const after = await prisma.document.count({ where:{ status:'draft', createdAt:{ gt: new Date('2026-07-24') } } });
  console.log(`drafts CREATED after the 2026-07-24 status change: ${after}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
