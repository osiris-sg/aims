/**
 * Seed a WhatsAppConnection row pointing at Meta's sandbox test number so the
 * send pipeline can be tested before the real (coexistence) number has a
 * permanent token. Reads the token from WHATSAPP_TEST_TOKEN in .env — the
 * token itself never appears in code or chat.
 *
 * Usage: npx ts-node scripts/seed-whatsapp-test-connection.ts "<org name>"
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Meta sandbox assets for app E-StatementNow (from the "Test the API" page).
const TEST_WABA_ID = '36194907403455900';
const TEST_PHONE_NUMBER_ID = '1112627728598022';
const TEST_DISPLAY_NUMBER = '+1 555-631-6765';

async function main() {
  const orgName = process.argv[2] || 'Osiris Technology Pte. Ltd.';
  const token = process.env.WHATSAPP_TEST_TOKEN;
  if (!token) {
    console.error('❌ WHATSAPP_TEST_TOKEN is not set in .env — paste the token from the Meta "Test the API" page first.');
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({ where: { name: { contains: orgName, mode: 'insensitive' } } });
  if (!org) {
    console.error(`❌ Organization matching "${orgName}" not found.`);
    process.exit(1);
  }

  const connection = await prisma.whatsAppConnection.upsert({
    where: { organizationId: org.id },
    update: {
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      displayPhoneNumber: TEST_DISPLAY_NUMBER,
      verifiedName: 'Meta sandbox test number',
      accessToken: token,
      status: 'CONNECTED',
      lastError: null,
      connectedAt: new Date(),
    },
    create: {
      organizationId: org.id,
      wabaId: TEST_WABA_ID,
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      displayPhoneNumber: TEST_DISPLAY_NUMBER,
      verifiedName: 'Meta sandbox test number',
      accessToken: token,
      status: 'CONNECTED',
    },
  });

  console.log(`✅ Seeded sandbox WhatsApp connection for "${org.name}" (${org.id})`);
  console.log(`   number ${connection.displayPhoneNumber} · phoneNumberId ${connection.phoneNumberId}`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
