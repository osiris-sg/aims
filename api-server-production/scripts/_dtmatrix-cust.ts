import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env.production','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{
  const c=await prisma.customer.findMany({where:{organizationId:ORG,name:{contains:'matrix',mode:'insensitive'}}});
  c.forEach((x:any)=>console.log(JSON.stringify({id:x.id,name:x.name,code:x.customerCode,email:x.email,address:x.address},null,0)));
  const docs=await prisma.document.findMany({where:{organizationId:ORG,type:'INVOICE',name:{startsWith:'TI2202609'}},select:{name:true}});
  console.log('existing Sept numbers:', docs.map((d:any)=>d.name).join(', ')||'none');
  const ri=await prisma.revenueItem.findFirst({where:{organizationId:ORG,code:'SV012'}});
  console.log('SV012:', JSON.stringify({name:ri?.name,unitPrice:ri?.unitPrice,accountCode:ri?.accountCode}));
})().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
