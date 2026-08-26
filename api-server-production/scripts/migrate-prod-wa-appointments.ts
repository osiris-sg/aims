/**
 * Targeted prod DDL for the PA features, applied without a full `db:push:prod`
 * so unrelated in-flight schema work from other branches isn't swept along.
 * All statements are additive and idempotent.
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/migrate-prod-wa-appointments.ts dotenv_config_path=.env.production
 *   ... --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const STATEMENTS: Array<[string, string]> = [
  [
    'WhatsAppScheduledMessage.recurAnchorDay',
    `ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN IF NOT EXISTS "recurAnchorDay" INTEGER`,
  ],
  [
    'WhatsAppAgentConfig.ownerNotifyNumber',
    `ALTER TABLE "WhatsAppAgentConfig" ADD COLUMN IF NOT EXISTS "ownerNotifyNumber" TEXT`,
  ],
  [
    'WhatsAppAppointment table',
    `CREATE TABLE IF NOT EXISTS "WhatsAppAppointment" (
       "id" TEXT NOT NULL,
       "organizationId" TEXT NOT NULL,
       "groupId" TEXT NOT NULL,
       "groupName" TEXT,
       "startsAt" TIMESTAMP(3) NOT NULL,
       "timeText" TEXT,
       "topic" TEXT,
       "venue" TEXT,
       "tentative" BOOLEAN NOT NULL DEFAULT false,
       "clientName" TEXT,
       "remindAt" TIMESTAMP(3) NOT NULL,
       "reminderStatus" TEXT NOT NULL DEFAULT 'PENDING',
       "remindedAt" TIMESTAMP(3),
       "error" TEXT,
       "sourceMessage" TEXT,
       "createdBy" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "WhatsAppAppointment_pkey" PRIMARY KEY ("id")
     )`,
  ],
  [
    'WhatsAppAppointment org/group index',
    `CREATE INDEX IF NOT EXISTS "WhatsAppAppointment_organizationId_groupId_idx"
       ON "WhatsAppAppointment"("organizationId", "groupId")`,
  ],
  [
    'WhatsAppAppointment due-reminder index',
    `CREATE INDEX IF NOT EXISTS "WhatsAppAppointment_reminderStatus_remindAt_idx"
       ON "WhatsAppAppointment"("reminderStatus", "remindAt")`,
  ],
];

async function main() {
  for (const [label, sql] of STATEMENTS) {
    if (!APPLY) {
      console.log(`[dry-run] ${label}`);
      continue;
    }
    await prisma.$executeRawUnsafe(sql);
    console.log(`✅ ${label}`);
  }

  if (APPLY) {
    const check = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'WhatsAppScheduledMessage' AND column_name = 'recurAnchorDay'`,
    );
    console.log(`\nrecurAnchorDay present: ${check.length > 0}`);
    const t = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'WhatsAppAppointment'`,
    );
    console.log(`WhatsAppAppointment present: ${t.length > 0}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
