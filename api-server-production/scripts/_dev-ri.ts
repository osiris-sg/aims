import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs'; import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const m=fs.readFileSync('.env','utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const p=new PrismaClient({adapter:new PrismaNeon({connectionString:new URL(m[1]).toString()})} as any);
const ORG='d068f159-e45a-4da8-beaf-62e903f44141';
(async()=>{console.log('revenue items:',await p.revenueItem.count({where:{organizationId:ORG}}));
console.log('journal entries:',await p.journalEntry.count({where:{organizationId:ORG}}));
console.log('invoices:',await p.document.count({where:{organizationId:ORG,type:'INVOICE'}}));})()
.catch(e=>console.error(e.message)).finally(()=>p.$disconnect());
