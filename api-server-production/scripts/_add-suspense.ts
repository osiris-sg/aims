import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile=process.argv[2]||'.env.production';
const m = fs.readFileSync(envFile,'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
async function main(){
  const ex = await prisma.chartOfAccount.findFirst({ where:{ organizationId:ORG, code:'CA900' } });
  if(ex){ console.log(`${envFile}: CA900 already exists`); return; }
  await prisma.chartOfAccount.create({ data:{ organizationId:ORG, code:'CA900',
    name:'Suspense — payments pending classification', accountType:'CURRENT_ASSET',
    category:'BALANCE_SHEET', normalBalance:'DEBIT',
    description:'Payments to individuals awaiting salary / contractor / drawings classification (guru reviewing one by one, 2026-08-18). Clear to EX010/EX011/CS003/CL020.',
    isSystem:false }});
  console.log(`${envFile}: created CA900 Suspense`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
