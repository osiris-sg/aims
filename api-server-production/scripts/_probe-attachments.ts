import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
async function main() {
  const withAtt = await p.document.findFirst({
    where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' }, attachments: { not: Prisma_DbNull as any } },
    select: { name: true, attachments: true },
  }).catch(() => null);
  // simpler: grab an email-ingested one
  const doc = withAtt || await p.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name: 'JP2605060085' }, select: { name: true, attachments: true } });
  console.log(doc?.name, JSON.stringify(doc?.attachments, null, 1)?.slice(0, 600));
}
const Prisma_DbNull = null;
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
