/**
 * Print recent WhatsApp messages for a connected number, newest last.
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_read-wa-thread.ts \
 *     1402606026260891 dotenv_config_path=.env.production
 *
 * Second arg = how many messages (default 40).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phoneNumberId = process.argv[2];
  const take = Number(process.argv[3] || 40);
  if (!phoneNumberId) throw new Error('Pass the phoneNumberId as the first argument.');

  const conn = await prisma.whatsAppConnection.findFirst({
    where: { phoneNumberId },
    select: { organizationId: true, displayPhoneNumber: true, verifiedName: true, status: true, createdAt: true },
  });
  if (!conn) {
    console.log(`❌ No WhatsAppConnection row for phoneNumberId ${phoneNumberId}.`);
    console.log('   That means webhooks for this number are still being dropped.');
    return;
  }
  const org = await prisma.organization.findUnique({
    where: { id: conn.organizationId },
    select: { name: true },
  });
  console.log(`📞 ${conn.displayPhoneNumber} (${conn.verifiedName}) — ${conn.status}`);
  console.log(`🏢 ${org?.name} · connected ${conn.createdAt.toISOString().slice(0, 16)}\n`);

  const msgs = await prisma.whatsAppMessage.findMany({
    where: { organizationId: conn.organizationId },
    orderBy: { createdAt: 'desc' },
    take,
    select: { direction: true, counterparty: true, body: true, status: true, createdAt: true },
  });
  if (!msgs.length) {
    console.log('(no messages stored yet)');
    return;
  }
  for (const m of msgs.reverse()) {
    const arrow = m.direction === 'INBOUND' ? '←' : '→';
    const when = m.createdAt.toISOString().replace('T', ' ').slice(0, 16);
    const body = (m.body || `<${m.status}, no text>`).replace(/\n/g, ' ⏎ ');
    console.log(`${when}  ${arrow} ${m.counterparty.padEnd(15)} ${body}`);
  }
  console.log(`\n${msgs.length} message(s).`);
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
