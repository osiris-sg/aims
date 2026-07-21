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
// Service logic (customers.service generateCustomerCode / suppliers.service
// generateSupplierCode): prefix letter = raw charAt(0).toUpperCase(), 'X' if empty.
const serviceLetter = (name: string) => (name || '').trim().charAt(0).toUpperCase() || 'X';
async function audit(label: string, env: string) {
  const p = clientFor(env);
  try {
    for (const kind of ['customer', 'supplier'] as const) {
      const base = kind === 'customer' ? 'C' : 'S';
      const field = kind === 'customer' ? 'customerCode' : 'supplierCode';
      const rows = await (p as any)[kind].findMany({ where: { organizationId: ORG }, select: { id: true, name: true, [field]: true } });
      const bad = rows.filter((r: any) => {
        const code = r[field] as string | null;
        if (!code) return false;
        return !code.startsWith(`${base}${serviceLetter(r.name)}`);
      });
      if (bad.length) {
        console.log(`${label} ${kind}s deviating from service logic: ${bad.length}`);
        for (const b of bad.slice(0, 15)) console.log(`   ${b[field]}  "${b.name}" (service prefix would be ${base}${serviceLetter(b.name)})`);
      } else {
        console.log(`${label} ${kind}s: all codes match service logic ✓`);
      }
    }
  } finally { await p.$disconnect(); }
}
async function main() {
  const target = process.argv[2] || '.env';
  await audit(target.padEnd(7), target);
}
main().catch(e => { console.error(e.message); process.exit(1); });
