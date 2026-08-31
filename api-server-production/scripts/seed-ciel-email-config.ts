import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const org = await prisma.organization.findUnique({ where: { name: 'CIEL INTERIOR PTE. LTD.' }, select: { id: true } });
  if (!org) throw new Error('CIEL org not found');
  // Lead-only allow-list for now: EZiD directly, and the firm's own domain
  // (Mike forwards Network PDFs from his mailbox). Widen when they start
  // sending supplier docs in.
  const watchedSenders = ['@ezid.sg', '@cielinterior.com'];
  await prisma.emailIngestConfig.upsert({
    where: { organizationId: org.id },
    update: { enabled: true, watchedSenders },
    create: { organizationId: org.id, enabled: true, watchedSenders, routingMode: 'AI' },
  });
  console.log('email ingest enabled for CIEL', org.id, 'senders:', watchedSenders.join(', '));
  await prisma.$disconnect();
})();
