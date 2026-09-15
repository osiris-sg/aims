import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  const docs=await prisma.document.findMany({where:{organizationId:ORG,name:{in:['TI2202609-003','TI2202609-004','TI2202609-005','TI2202609-006']}},orderBy:{name:'asc'}});
  console.log('Print each from AIMS (real TI2 template), then Save as PDF:\n');
  for(const d of docs as any[])
    console.log(`  ${d.name}  ${(d.config as any).referenceNo}\n    https://app.ai-ms.io/portal/documents/view/${d.type}/${d.documentTemplateId}/${d.id}?autoprint=true\n`);
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
