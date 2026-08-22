/**
 * Creates a DAILY recurring scheduled WhatsApp message on PROD due in ~90s.
 * Tests both delivery and the recurrence re-arm (after sending it should go
 * back to PENDING with scheduledAt +1 day and recurCount 1).
 *
 *   npx ts-node -r dotenv/config scripts/_test-scheduled.ts dotenv_config_path=.env.production
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
const TO = process.argv[2] || '6591151041';

async function main() {
  const when = new Date(Date.now() + 90 * 1000);
  const row = await prisma.whatsAppScheduledMessage.create({
    data: {
      organizationId: ORG,
      to: TO,
      body: 'AIMS scheduled-message test — please ignore 🙏',
      scheduledAt: when,
      recurrence: 'DAILY',
      status: 'PENDING',
      createdBy: 'test-script',
    },
  });
  console.log('created', row.id);
  console.log('  to:', row.to, '| due:', row.scheduledAt.toISOString(), '| recurrence:', row.recurrence);
  console.log('  (prod scheduler ticks every 60s — watch for SENT/PENDING+1day)');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
