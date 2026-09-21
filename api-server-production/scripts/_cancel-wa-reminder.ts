/**
 * Cancel a pending group appointment reminder so it never posts.
 *
 * Dry run (lists matches, changes nothing):
 *   npx ts-node -r dotenv/config --transpile-only scripts/_cancel-wa-reminder.ts tham dotenv_config_path=.env.production
 * Apply:
 *   ... scripts/_cancel-wa-reminder.ts tham --apply dotenv_config_path=.env.production
 *
 * The filter matches the group name OR the topic, case-insensitive.
 * Omit it to list every pending reminder.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = 'ad9127a7-cbc4-4108-b014-8b32123a5362'; // Denzel Office
const APPLY = process.argv.includes('--apply');
const filter = process.argv.slice(2).find((a) => !a.startsWith('--') && !a.startsWith('dotenv_')) || '';

const sg = (d: Date) =>
  d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });

async function main() {
  const rows = await prisma.whatsAppAppointment.findMany({
    where: {
      organizationId: ORG,
      reminderStatus: 'PENDING',
      ...(filter
        ? {
            OR: [
              { groupName: { contains: filter, mode: 'insensitive' } },
              { topic: { contains: filter, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { remindAt: 'asc' },
  });

  if (!rows.length) {
    console.log(filter ? `No pending reminder matches "${filter}".` : 'No pending reminders.');
    return;
  }

  console.log(`${rows.length} pending reminder(s)${filter ? ` matching "${filter}"` : ''}:\n`);
  for (const r of rows) {
    console.log(`  ${r.id}`);
    console.log(`    topic:    ${r.topic || '(none)'}`);
    console.log(`    chat:     ${r.groupName || r.groupId}`);
    console.log(`    starts:   ${sg(r.startsAt)}${r.tentative ? ' (tentative)' : ''}`);
    console.log(`    reminds:  ${sg(r.remindAt)}  -> ${r.clientName || 'them'}\n`);
  }

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to cancel the above.');
    return;
  }
  const res = await prisma.whatsAppAppointment.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { reminderStatus: 'CANCELLED' },
  });
  console.log(`✅ Cancelled ${res.count} reminder(s). They will not be posted.`);
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
