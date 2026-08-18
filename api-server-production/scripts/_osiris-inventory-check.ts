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
  const inv = await prisma.inventory.findMany({ where:{ organizationId:ORG }, select:{ id:true, sku:true, quantity:true } });
  console.log(`Inventory rows in Osiris: ${inv.length}`);
  const docs = await prisma.document.findMany({ where:{ organizationId:ORG }, select:{ name:true, config:true } });
  const used = new Set<string>();
  for(const d of docs as any[]) for(const it of ((d.config?.items)||[]))
    if(it.inventoryItemId) used.add(String(it.inventoryItemId));
  console.log(`referenced by a surviving document: ${inv.filter((i:any)=>used.has(i.id)).length}`);
  inv.forEach((i:any)=>console.log(`  ${String(i.sku||'(no sku)').padEnd(16)} qty=${String(i.quantity??'-').padEnd(5)} ${used.has(i.id)?'IN USE':'unused'}`));
  const assets = await prisma.asset.count({ where:{ organizationId:ORG } });
  console.log(`Assets in Osiris: ${assets}`);
}
main().catch(e=>console.error(e.message)).finally(()=>prisma.$disconnect());
