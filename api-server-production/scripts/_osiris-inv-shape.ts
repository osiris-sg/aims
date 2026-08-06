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
  const d = await prisma.document.findFirst({
    where: { organizationId: ORG, type: 'INVOICE', name: { contains: '2607' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!d) { console.log('no invoice found'); return; }
  console.log('name:', d.name, '| status:', d.status, '| templateId:', d.documentTemplateId);
  console.log('CONFIG:\n', JSON.stringify(d.config, null, 1).slice(0, 4000));
  const tmpl = await prisma.documentTemplate.findUnique({ where: { id: d.documentTemplateId } });
  console.log('\nTEMPLATE:', tmpl?.name, '| type:', tmpl?.type, '| org:', tmpl?.organizationId);
  const act = await prisma.organizationActiveTemplate.findMany({ where: { organizationId: ORG } });
  console.log('ACTIVE TEMPLATES:', JSON.stringify(act.map((a:any)=>({type:a.type,templateId:a.templateId}))));
  const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: 'Biofuel', mode: 'insensitive' } } });
  console.log('CUSTOMER Biofuel:', cust ? `${cust.id} | ${cust.name}` : 'NOT FOUND');
  const fmts = await prisma.documentNumberFormat.findMany({ where: { organizationId: ORG } });
  console.log('NUMBER FORMATS:', JSON.stringify(fmts.map((f:any)=>({type:f.documentType,pattern:f.pattern,next:f.nextNumber,name:f.name}))));
}
main().catch((e)=>console.error(e.message)).finally(()=>prisma.$disconnect());
