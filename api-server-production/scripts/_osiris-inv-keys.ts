import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const envFile = process.argv[2] || '.env';
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
async function main() {
  console.log(`==== ${envFile} ====`);
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE' },
    orderBy: { createdAt: 'desc' }, take: 6,
  });
  for (const d of docs) {
    const c: any = d.config || {};
    const { items, ...rest } = c;
    console.log(`\n--- ${d.name} (${d.status}) tmpl=${d.documentTemplateId.slice(0,8)} items=${(items||[]).length}`);
    console.log(JSON.stringify(rest).slice(0, 1500));
  }
  const tmpls = await prisma.documentTemplate.findMany({ where: { type: 'INVOICE' }, select: { id: true, name: true, organizationId: true, isActive: true } });
  console.log('\nINVOICE templates (all orgs):');
  tmpls.forEach((t:any)=>console.log(`  ${t.id} | ${t.name} | org=${t.organizationId.slice(0,8)} | active=${t.isActive}`));
}
main().catch((e)=>console.error(e.message)).finally(()=>prisma.$disconnect());
