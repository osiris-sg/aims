/** READ-ONLY: export Biofuel PROD inventory→deployment picture as JSON. */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m);
if (!m) throw new Error('no prod url');
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
async function main() {
  const assignments = await prisma.assignment.findMany({
    where: { project: { organizationId: ORG } },
    select: {
      inventoryId: true,
      inventory: { select: { sku: true, asset: { select: { name: true } } } },
      project: { select: { name: true, customer: { select: { name: true } } } },
      projectDeployment: { select: { type: true, deployedDate: true, offHiredDate: true, monthlyRate: true, status: true } },
    },
  } as any);
  const rows = assignments.map((a: any) => ({
    serial: a.inventory?.sku || null,
    item: a.inventory?.asset?.name || null,
    project: a.project?.name || null,
    customer: a.project?.customer?.name || null,
    type: a.projectDeployment?.type || null,
    deployed: a.projectDeployment?.deployedDate || null,
    offHired: a.projectDeployment?.offHiredDate || null,
    status: a.projectDeployment?.status || null,
  }));
  fs.writeFileSync('/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad/prod-rentals.json', JSON.stringify(rows, null, 1));
  console.log(`exported ${rows.length} assignment rows (with serial: ${rows.filter((r: any) => r.serial).length})`);
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type || 'null'] = (byType[r.type || 'null'] || 0) + 1;
  console.log('by deployment type:', JSON.stringify(byType));
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
