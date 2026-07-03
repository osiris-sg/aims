import { PrismaClient } from '@prisma/client';
import * as fs from 'fs'; import * as dotenv from 'dotenv';
const prodUrl = dotenv.parse(fs.readFileSync('.env.production')).DATABASE_URL;
const devUrl = dotenv.parse(fs.readFileSync('.env')).DATABASE_URL;
const prod = new PrismaClient({ datasources: { db: { url: prodUrl } } });
const dev = new PrismaClient({ datasources: { db: { url: devUrl } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const c = await dev.xeroConnection.findUnique({ where: { organizationId: ORG } });
  if (!c) { console.log('no dev XeroConnection'); return; }
  console.log(`dev token: tenant=${c.tenantId} accessExp=${c.accessTokenExpiresAt.toISOString()}`);
  await prod.xeroConnection.upsert({
    where: { organizationId: ORG },
    update: { tenantId: c.tenantId, accessToken: c.accessToken, refreshToken: c.refreshToken, accessTokenExpiresAt: c.accessTokenExpiresAt, refreshTokenExpiresAt: c.refreshTokenExpiresAt },
    create: { organizationId: ORG, tenantId: c.tenantId, accessToken: c.accessToken, refreshToken: c.refreshToken, accessTokenExpiresAt: c.accessTokenExpiresAt, refreshTokenExpiresAt: c.refreshTokenExpiresAt },
  });
  console.log('✓ copied XeroConnection to prod');
}
main().catch(e => console.log('ERR', e.message?.slice(0, 150))).finally(async () => { await dev.$disconnect(); await prod.$disconnect(); });
