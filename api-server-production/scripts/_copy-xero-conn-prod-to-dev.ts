/** ONE-OFF: copy Biofuel XeroConnection PROD -> DEV (dev's refresh token was consumed). */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
function urlFrom(envFile: string): string {
  const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!m) throw new Error(`No DATABASE_URL in ${envFile}`);
  return m[1];
}
async function main() {
  const prod = new PrismaClient({ datasources: { db: { url: urlFrom('.env.production') } } });
  const dev = new PrismaClient({ datasources: { db: { url: urlFrom('.env') } } });
  try {
    const c = await prod.xeroConnection.findUnique({ where: { organizationId: ORG } });
    if (!c) throw new Error('No prod XeroConnection');
    const { id, createdAt, updatedAt, ...data } = c as any;
    await dev.xeroConnection.upsert({ where: { organizationId: ORG }, update: data, create: data });
    console.log(`✓ copied prod XeroConnection (updatedAt=${updatedAt.toISOString()}) into dev`);
  } finally { await prod.$disconnect(); await dev.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
