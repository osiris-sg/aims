import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function main() {
  const conn = await prod.xeroConnection.findUnique({ where: { organizationId: ORG } });
  const res = await fetch('https://api.xero.com/api.xro/2.0/Payments?page=1', { headers: { Authorization: `Bearer ${conn!.accessToken}`, 'Xero-Tenant-Id': conn!.tenantId, Accept: 'application/json' } });
  const json: any = await res.json();
  const p = (json.Ayments || json.Payments || [])[0];
  console.log(JSON.stringify(p, null, 2).slice(0, 900));
}
main().finally(() => prod.$disconnect());
