import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const TANGLIN = '909c42f6-b361-4c07-a905-e45fa2774f03';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const reqs: any[] = await p.$queryRawUnsafe(
    `SELECT id, token, "customerName", "projectName", "createdAt", "expiresAt", "revokedAt", "submittedAt", "submissionCount"
     FROM "CustomerInfoRequest" WHERE "customerId" = $1::uuid ORDER BY "createdAt" DESC`, TANGLIN);
  console.log('requests for Tanglin:', reqs.length);
  for (const r of reqs) {
    console.log(`\n— ${r.projectName} | minted ${r.createdAt.toISOString()} | expires ${r.expiresAt?.toISOString()?.slice(0,10)} | revoked ${r.revokedAt ? 'YES' : 'no'} | submitted ${r.submittedAt ? r.submittedAt.toISOString() : 'NOT YET'} | submissions ${r.submissionCount}`);
    console.log(`  link token: ${String(r.token).slice(0, 12)}…`);
    const contacts: any[] = await p.$queryRawUnsafe(
      `SELECT "group", name, email, phone, "sortOrder", "supersededAt" FROM "CustomerInfoContact" WHERE "requestId" = $1 ORDER BY "supersededAt" NULLS FIRST, "group", "sortOrder"`, r.id);
    for (const c of contacts) console.log(`   [${c.group}] ${c.name} | ${c.email || '-'} | ${c.phone || '-'}${c.supersededAt ? ' (superseded)' : ''}`);
    if (!contacts.length) console.log('   (no contacts submitted)');
  }
  await p.$disconnect();
})();
