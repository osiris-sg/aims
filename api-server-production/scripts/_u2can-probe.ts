import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env';
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

async function main() {
  console.log(`\n================ ${envFile} ================`);
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log('ORGS:', orgs.map((o) => `${o.name} [${o.id}]`).join('\n      '));

  const u2 = orgs.find((o) => /u2can|combat/i.test(o.name));
  if (!u2) {
    console.log('\nNo U2CAN org found.');
    return;
  }
  const ORG = u2.id;
  console.log(`\n--- ${u2.name} (${ORG}) ---`);
  const coaCount = await prisma.chartOfAccount.count({ where: { organizationId: ORG } });
  const je = await prisma.journalEntry.count({ where: { organizationId: ORG } });
  const imports = await prisma.bankStatementImport.count({ where: { organizationId: ORG } });
  const setting = await prisma.accountingSetting.findUnique({ where: { organizationId: ORG } });
  console.log(`CoA=${coaCount} JE=${je} bankImports=${imports} accountingSetting=${!!setting}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
