import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
function clientFor(envFile: string): PrismaClient {
  const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
  const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
}
async function probe(label: string, envFile: string) {
  const p = clientFor(envFile);
  try {
    const [cTotal, cNoCode, sTotal, sNoCode] = await Promise.all([
      p.customer.count({ where: { organizationId: ORG } }),
      p.customer.count({ where: { organizationId: ORG, OR: [{ customerCode: null }, { customerCode: '' }] } }),
      p.supplier.count({ where: { organizationId: ORG } }),
      p.supplier.count({ where: { organizationId: ORG, OR: [{ supplierCode: null }, { supplierCode: '' }] } }),
    ]);
    const cSamples = await p.customer.findMany({ where: { organizationId: ORG, NOT: [{ customerCode: null }, { customerCode: '' }] }, select: { customerCode: true }, take: 8, orderBy: { customerCode: 'desc' } });
    const sSamples = await p.supplier.findMany({ where: { organizationId: ORG, NOT: [{ supplierCode: null }, { supplierCode: '' }] }, select: { supplierCode: true }, take: 8, orderBy: { supplierCode: 'desc' } });
    console.log(`${label}: customers ${cTotal} (no code: ${cNoCode})  suppliers ${sTotal} (no code: ${sNoCode})`);
    console.log(`   cust codes: ${cSamples.map((x) => x.customerCode).join(', ') || '(none)'}`);
    console.log(`   sup codes:  ${sSamples.map((x) => x.supplierCode).join(', ') || '(none)'}`);
  } finally { await p.$disconnect(); }
}
async function main() {
  await probe('DEV    ', '.env');
  await probe('STAGING', '.env.staging');
  await probe('PROD   ', '.env.production');
}
main().catch(e => { console.error(e.message); process.exit(1); });
