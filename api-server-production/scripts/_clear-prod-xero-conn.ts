import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const p = new PrismaClient({ datasources: { db: { url: m[1] } } });
async function main() {
  const del = await p.xeroConnection.deleteMany({ where: { organizationId: ORG } });
  console.log(`deleted ${del.count} stale prod XeroConnection row(s)`);
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
