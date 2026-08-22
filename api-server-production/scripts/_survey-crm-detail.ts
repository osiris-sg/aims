/** Which numbers/eras the Osiris Tech CRM data actually belongs to. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OSIRIS = 'd068f159-e45a-4da8-beaf-62e903f44141';

async function main() {
  const msgs = await prisma.whatsAppMessage.groupBy({
    by: ['counterparty'],
    where: { organizationId: OSIRIS },
    _count: { _all: true },
    _max: { createdAt: true },
    _min: { createdAt: true },
  });
  console.log('Messages by counterparty:');
  msgs
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 12)
    .forEach((m) =>
      console.log(
        `  ${String(m.counterparty).padEnd(26)} ${String(m._count._all).padStart(4)}  ${m._min.createdAt?.toISOString().slice(0, 10)} → ${m._max.createdAt?.toISOString().slice(0, 10)}`,
      ),
    );

  const qna = await prisma.whatsAppQnA.findMany({
    where: { organizationId: OSIRIS },
    select: { question: true },
    orderBy: { createdAt: 'asc' },
    take: 3,
  });
  console.log('\nFirst training pairs (confirms whose agent this is):');
  qna.forEach((q) => console.log(`  • ${q.question.slice(0, 70)}`));

  const cfg = await prisma.whatsAppAgentConfig.findUnique({
    where: { organizationId: OSIRIS },
    select: { enabled: true, autoSendEnabled: true, aiGuidance: true },
  });
  console.log('\nAgent config:', JSON.stringify({ ...cfg, aiGuidance: cfg?.aiGuidance?.slice(0, 80) + '…' }, null, 1));

  const contacts = await prisma.whatsAppContact.findMany({
    where: { organizationId: OSIRIS },
    select: { waId: true, profileName: true, appContactName: true },
  });
  console.log('\nContacts:');
  contacts.forEach((c) => console.log(`  ${c.waId}  ${c.appContactName || c.profileName || ''}`));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
