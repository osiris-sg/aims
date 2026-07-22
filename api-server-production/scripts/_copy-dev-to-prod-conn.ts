import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
function urlFrom(f: string) { const m = fs.readFileSync(f, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!; return m[1]; }
async function main() {
  const dev = new PrismaClient({ datasources: { db: { url: urlFrom('.env') } } });
  const prod = new PrismaClient({ datasources: { db: { url: urlFrom('.env.production') } } });
  try {
    const c = await dev.xeroConnection.findUnique({ where: { organizationId: ORG } });
    if (!c) throw new Error('no dev conn');
    const { id, createdAt, updatedAt, ...data } = c as any;
    await prod.xeroConnection.upsert({ where: { organizationId: ORG }, update: data, create: data });
    console.log(`✓ dev token (updated ${updatedAt.toISOString()}) → prod`);
  } finally { await dev.$disconnect(); await prod.$disconnect(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
