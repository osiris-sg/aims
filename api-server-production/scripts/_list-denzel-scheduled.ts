/** Scheduled WhatsApp messages currently held for the Denzel Office org. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = 'ad9127a7-cbc4-4108-b014-8b32123a5362';

const sgt = (d: Date | null) =>
  d
    ? d.toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Singapore',
      })
    : '—';

(async () => {
  const rows = await prisma.whatsAppScheduledMessage.findMany({
    where: { organizationId: ORG },
    orderBy: { scheduledAt: 'asc' },
  });
  console.log(`Scheduled messages in Denzel Office: ${rows.length}\n`);
  for (const r of rows) {
    console.log(`[${r.status}] ${r.recurrence !== 'NONE' ? r.recurrence : 'one-off'}`);
    console.log(`  to        ${r.to}`);
    console.log(`  next send ${sgt(r.scheduledAt)} SGT`);
    console.log(`  sent so far ${r.recurCount}${r.recurUntil ? ` | until ${sgt(r.recurUntil)}` : ''}`);
    console.log(`  body      "${(r.body || '').slice(0, 90)}"`);
    if (r.error) console.log(`  last error ${r.error.slice(0, 90)}`);
    console.log('');
  }

  const appts = await prisma.whatsAppAppointment.count({ where: { organizationId: ORG } });
  console.log(`Appointment reminders stored: ${appts}`);
  await prisma.$disconnect();
})();
