/**
 * Denzel's monthly payment reminders, posted into each client's own group.
 *
 * Group delivery (rather than a direct message) is deliberate: a direct
 * free-text send is blocked by WhatsApp's 24-hour window unless the client
 * happened to message in the last day, which a monthly reminder never can rely
 * on. Groups have no such limit, and the advisor is in the group anyway.
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/seed-denzel-payment-reminders.ts dotenv_config_path=.env.production
 *   ... --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = 'ad9127a7-cbc4-4108-b014-8b32123a5362'; // Denzel Office
const APPLY = process.argv.includes('--apply');

// 09:00 Singapore == 01:00 UTC.
const at9amSgt = (year: number, monthIndex: number, day: number) => new Date(Date.UTC(year, monthIndex, day, 1, 0, 0, 0));

const REMINDERS = [
  {
    who: 'Thed',
    groupId: '120363428230333192@g.us',
    day: 27,
    first: at9amSgt(2026, 7, 27), // 27 Aug
    body:
      'Hi Thed!\n\nReminder to make payment for your FWD Investment policy!\n\n' +
      'Do kindly send the proof of payment once you are done! ' +
      '(Remember to input your policy number at the reference side)',
  },
  {
    who: 'Jerry Soh',
    groupId: '120363428670112322@g.us',
    day: 31,
    first: at9amSgt(2026, 7, 31), // 31 Aug
    body: 'Hello Jerry! Remember to make payment for both your Investment and Insurance tomorrow! \u{1F64F}\u{1F3FB}',
  },
  {
    who: 'Ruby Tay',
    groupId: '120363426269896291@g.us',
    day: 25,
    first: at9amSgt(2026, 8, 25), // 25 Sep — the 25th has already passed this month
    body:
      'Hi Ruby! Reminder to make your payment for your Pulsar and Wealth Voyage!\n\n' +
      "If you need Denzel's help for the QR code, do pm him! Thank you!",
  },
  {
    who: 'Claire Tita',
    groupId: '120363408882703917@g.us',
    day: 2,
    first: at9amSgt(2026, 8, 2), // 2 Sep
    body:
      'Hi Claire! \u{1F60A}\n\nJust a gentle reminder to top up your OCBC account before the insurance ' +
      'premium deduction goes through, so everything can be deducted smoothly!\n\nThank you! \u{1FAF6}\u{1F3FB}',
  },
];

const fmt = (d: Date) =>
  d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });

async function main() {
  for (const r of REMINDERS) {
    const existing = await prisma.whatsAppScheduledMessage.findFirst({
      where: { organizationId: ORG, to: r.groupId, status: 'PENDING' },
    });
    if (existing) {
      console.log(`${r.who}: already scheduled (${fmt(existing.scheduledAt)}) — skipping`);
      continue;
    }
    console.log(`${APPLY ? '' : '[dry-run] '}${r.who}: monthly on the ${r.day}th, first ${fmt(r.first)} SGT`);
    console.log(`    "${r.body.replace(/\n+/g, ' ').slice(0, 80)}…"`);
    if (APPLY) {
      await prisma.whatsAppScheduledMessage.create({
        data: {
          organizationId: ORG,
          to: r.groupId,
          body: r.body,
          scheduledAt: r.first,
          recurrence: 'MONTHLY',
          recurAnchorDay: r.day,
          status: 'PENDING',
          createdBy: 'denzel-payment-reminders',
        },
      });
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
