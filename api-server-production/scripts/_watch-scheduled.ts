/** Polls a scheduled-message row until it sends (or fails), so we can see the
 *  prod scheduler pick it up and — for recurring rows — re-arm the next run. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ID = process.argv[2];

async function main() {
  if (!ID) throw new Error('pass the scheduled message id');
  let last = '';
  for (let i = 0; i < 40; i++) {
    const r = await prisma.whatsAppScheduledMessage.findUnique({
      where: { id: ID },
      select: { status: true, scheduledAt: true, sentMessageId: true, error: true, recurCount: true, recurrence: true },
    });
    if (!r) throw new Error('row not found');
    const line = `${r.status} | next ${r.scheduledAt.toISOString()} | sent#${r.recurCount} | ${r.sentMessageId ? 'msgId ' + r.sentMessageId.slice(0, 8) : 'no msg'}${r.error ? ' | ERR ' + r.error.slice(0, 60) : ''}`;
    if (line !== last) {
      console.log(new Date().toISOString().slice(11, 19), line);
      last = line;
    }
    // Done when it has sent at least once (recurring rows go back to PENDING)
    if (r.recurCount > 0 || r.status === 'SENT' || r.status === 'FAILED') {
      console.log(r.recurCount > 0 && r.status === 'PENDING' ? '\n✅ sent AND re-armed for the next occurrence' : '\n done');
      break;
    }
    await new Promise((res) => setTimeout(res, 15000));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
