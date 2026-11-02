/**
 * Multi-organisation users (2026-11-02): create PendingOrgInvite in the DEV
 * database (per-org tenancy: `prisma db push` refuses it; platform model, so
 * schema "platform"). Prod needs nothing: Render's build pushes schema.prisma
 * (a new table, additive).
 *
 *   npx ts-node --transpile-only scripts/_multiorg-dev-tables.ts            # dry run: prints the SQL
 *   npx ts-node --transpile-only scripts/_multiorg-dev-tables.ts --apply    # runs it (IF NOT EXISTS)
 *
 * Refuses to run against PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { Client } from 'pg';

const apply = process.argv.includes('--apply');
const s = (process.argv.find((a) => a.startsWith('--schema='))?.split('=')[1] || 'platform').replace(/[^a-z0-9_]/gi, '');
const sql = [
  `CREATE TABLE IF NOT EXISTS "${s}"."PendingOrgInvite" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "email" TEXT NOT NULL,
       "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
       "invitedById" TEXT,
       "invitedByName" TEXT,
       "clerkInvitationId" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       "acceptedAt" TIMESTAMP(3),
       "acceptedUserId" TEXT,
       "revokedAt" TIMESTAMP(3),
       CONSTRAINT "PendingOrgInvite_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PendingOrgInvite_organizationId_email_key" ON "${s}"."PendingOrgInvite"("organizationId", "email")`,
  `CREATE INDEX IF NOT EXISTS "PendingOrgInvite_email_idx" ON "${s}"."PendingOrgInvite"("email")`,
];

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!apply) {
    for (const q of sql) console.log(q + ';');
    console.log(`\n-- dry run (schema ${s}); pass --apply to execute`);
    return;
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (const q of sql) await c.query(q);
    const r = await c.query(`select count(*)::int n from information_schema.tables where table_schema=$1 and table_name='PendingOrgInvite'`, [s]);
    console.log(`schema ${s}: PendingOrgInvite ${r.rows[0].n ? 'present' : 'MISSING'}`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
