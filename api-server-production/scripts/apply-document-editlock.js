/**
 * Idempotent migration: concurrent-edit guard columns on "Document".
 *  - editingByUserId / editingByName / editingAt  (presence lock + heartbeat)
 *  - lastActivityAt                               (last real content edit)
 *  - version                                      (optimistic concurrency)
 *
 * Usage:
 *   node scripts/apply-document-editlock.js                       # .env (local/dev)
 *   ENV_FILE=.env.production node scripts/apply-document-editlock.js
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env', override: true });
const { PrismaClient } = require('@prisma/client');

(async () => {
  const which = process.env.ENV_FILE || '.env';
  const host = (process.env.DATABASE_URL || '').replace(/\/\/[^@]*@/, '//***@').replace(/(@[^/]*).*/, '$1');
  console.log(`\n=== Applying Document edit-lock cols to ${which} (${host}) ===`);
  const p = new PrismaClient();
  try {
    await p.$executeRawUnsafe('ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "editingByUserId" text;');
    await p.$executeRawUnsafe('ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "editingByName" text;');
    await p.$executeRawUnsafe('ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "editingAt" timestamp(3);');
    await p.$executeRawUnsafe('ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "lastActivityAt" timestamp(3);');
    await p.$executeRawUnsafe('ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;');
    const cols = await p.$queryRawUnsafe(
      "SELECT column_name FROM information_schema.columns WHERE table_name='Document' AND column_name IN ('editingByUserId','editingByName','editingAt','lastActivityAt','version') ORDER BY column_name;",
    );
    console.log('  Document lock columns present:', cols.map((c) => c.column_name).join(', '));
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
