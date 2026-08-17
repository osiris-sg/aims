import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m = fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
async function main(){
  const t = await prisma.recurringInvoiceTemplate.findMany({ where:{ organizationId:ORG } });
  console.log(`RecurringInvoiceTemplate rows for Osiris: ${t.length}`);
  t.forEach((x:any)=>console.log('  '+JSON.stringify({name:x.name,isActive:x.isActive,frequency:x.frequency,nextRunDate:x.nextRunDate,lastRunAt:x.lastRunAt,customerId:x.customerId},null,0)));
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
