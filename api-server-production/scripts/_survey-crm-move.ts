/**
 * Read-only survey ahead of moving the CRM/WhatsApp data from Osiris Tech into
 * a dedicated org for Denzel. Prints what exists and what a move would touch.
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_survey-crm-move.ts dotenv_config_path=.env.production
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OSIRIS = 'd068f159-e45a-4da8-beaf-62e903f44141';

async function main() {
  const org = await prisma.organization.findUnique({ where: { id: OSIRIS }, select: { name: true } });
  console.log(`Source org: ${org?.name} (${OSIRIS})\n`);

  const counts = {
    connection: await prisma.whatsAppConnection.count({ where: { organizationId: OSIRIS } }),
    agentConfig: await prisma.whatsAppAgentConfig.count({ where: { organizationId: OSIRIS } }),
    qna: await prisma.whatsAppQnA.count({ where: { organizationId: OSIRIS } }),
    messages: await prisma.whatsAppMessage.count({ where: { organizationId: OSIRIS } }),
    contacts: await prisma.whatsAppContact.count({ where: { organizationId: OSIRIS } }),
    suggestions: await prisma.whatsAppSuggestion.count({ where: { organizationId: OSIRIS } }),
    scheduled: await prisma.whatsAppScheduledMessage.count({ where: { organizationId: OSIRIS } }),
  };
  console.log('CRM data that would move:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${v}`);

  const conn = await prisma.whatsAppConnection.findFirst({
    where: { organizationId: OSIRIS },
    select: { displayPhoneNumber: true, verifiedName: true, wabaId: true, phoneNumberId: true, status: true },
  });
  console.log('\nConnection:', JSON.stringify(conn, null, 1));

  // What else lives in this org that must NOT move (it's the platform org).
  const other = {
    customers: await prisma.customer.count({ where: { organizationId: OSIRIS } }),
    documents: await prisma.document.count({ where: { organizationId: OSIRIS } }),
    journals: await prisma.journalEntry.count({ where: { organizationId: OSIRIS } }),
  };
  console.log('\nNon-CRM data in the same org (stays put):');
  for (const [k, v] of Object.entries(other)) console.log(`  ${k.padEnd(12)} ${v}`);

  // Existing orgs, so we don't create a duplicate.
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  console.log(`\nExisting orgs (${orgs.length}):`);
  orgs.forEach((o) => console.log(`  ${o.name}  [${o.id}]`));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
