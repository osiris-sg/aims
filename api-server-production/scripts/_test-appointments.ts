/**
 * Exercises appointment extraction against realistic advisor messages, in the
 * free-form styles he actually writes, plus non-appointments that must be
 * ignored and a reschedule that must UPDATE rather than duplicate.
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_test-appointments.ts
 */
import { PrismaClient } from '@prisma/client';
import { WhatsAppAgentService } from '../src/whatsapp/whatsapp-agent.service';

const prisma = new PrismaClient();
const agent = new WhatsAppAgentService(prisma as any);

const CASES: Array<[string, string, boolean]> = [
  [
    'structured (his screenshot)',
    `📅 FWD Invest Flexi VII Application

Date: 26 June 2026
Time: 3pm (Tentatively)
Venue: Punggol Coast Huggs Coffee (Tentatively)

@Denzel's PA

I put here first to remind myself first`,
    true,
  ],
  ['one-liner', 'Meeting with Krystal on 12 Sept 2026, 2.30pm at Starbucks Tampines', true],
  ['casual', 'lets meet next tuesday 4pm at my office to go through the shield plan', true],
  ['no venue', 'Appointment 3 Oct 2026 11am - policy review', true],
  ['not an appointment', 'ok noted thanks', false],
  ['not an appointment 2', 'The FWD plan gives 101% death benefit and loyalty bonus from yr 11', false],
  ['question', 'what time are you free tomorrow?', false],
];

async function main() {
  const now = new Date().toISOString();
  let pass = 0;
  for (const [label, text, expect] of CASES) {
    try {
      const r = await agent.extractAppointment(text, now);
      const got = !!r?.isAppointment;
      const ok = got === expect;
      if (ok) pass++;
      console.log(
        `${ok ? '✅' : '❌'} ${label.padEnd(24)} ${
          got ? `${r!.date} ${r!.time || '--:--'} | ${r!.topic || 'no topic'} | ${r!.venue || 'no venue'}${r!.tentative ? ' | tentative' : ''}` : 'not an appointment'
        }`,
      );
    } catch (e: any) {
      console.log(`❌ ${label.padEnd(24)} ERROR ${e.message}`);
    }
  }

  // Reschedule must point at the existing appointment, not create a new one.
  const existing = [{ id: 'appt-123', startsAt: '2026-06-26T07:00:00.000Z', topic: 'FWD Invest Flexi VII' }];
  const upd = await agent.extractAppointment('Sorry need to push the FWD meeting to 28 June, 4pm same place', now, existing);
  const linked = upd?.updatesId === 'appt-123';
  console.log(`${linked ? '✅' : '❌'} reschedule -> ${linked ? 'updates appt-123' : 'updatesId=' + upd?.updatesId} (${upd?.date} ${upd?.time})`);

  console.log(`\n${pass}/${CASES.length} classified correctly`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
