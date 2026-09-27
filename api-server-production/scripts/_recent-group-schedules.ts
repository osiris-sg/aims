import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = 'ad9127a7-cbc4-4108-b014-8b32123a5362'; // Denzel Office
(async () => {
  const rows = await prisma.whatsAppScheduledMessage.findMany({
    where: { organizationId: ORG, to: { endsWith: '@g.us' } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, to: true, body: true, scheduledAt: true, status: true, recurrence: true, createdBy: true, createdAt: true },
  });
  if (!rows.length) { console.log('No group-targeted scheduled messages at all.'); return; }
  const sg = (d: Date) => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' });
  for (const r of rows) {
    console.log(`${r.status.padEnd(9)} ${sg(r.scheduledAt)}  ${r.recurrence !== 'NONE' ? '('+r.recurrence+') ' : ''}by ${r.createdBy || '?'}`);
    console.log(`   created ${sg(r.createdAt)}   -> ${r.to}`);
    console.log(`   "${r.body.slice(0, 90)}"\n`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
