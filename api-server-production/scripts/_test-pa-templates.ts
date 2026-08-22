/**
 * Fires natural client phrasings at the PROD group-agent endpoint and reports
 * which get a templated reply vs stay silent. Natural wording (not the exact
 * trained question) is the real test of the strict template gate.
 *
 *   npx ts-node scripts/_test-pa-templates.ts
 */

const API = 'https://aims-ahwy.onrender.com/whatsapp/group-agent';
const TOKEN = process.env.BRIDGE_TOKEN || 'd208e35f7826f9cf6aedcf9646228cb61a3e25d3231ba17d';
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';

// [label, natural client message, expectReply]
const CASES: Array<[string, string, boolean]> = [
  ['reschedule', 'hi can i change my appointment to another day', true],
  ['book appt', 'id like to meet denzel next week can you arrange', true],
  ['PA claim', 'i went to see the doctor yesterday for my back, can i claim?', true],
  ['shield claim', 'i was warded at mount e last week for dengue, can i claim shield', true],
  ['thanks', 'thank you so much!', true],
  ['sent docs', 'ive sent you the receipt and the memo just now', true],
  ['claim status', 'any update on my claim ah', true],
  ['singlife pay', 'how do i pay my singlife premium', true],
  ['fwd pay', 'how to make payment for fwd policy', true],
  ['hsbc pay', 'how do i pay my hsbc life premium', true],
  ['policy copy', 'can i get a copy of my policy document', true],
  ['update details', 'i changed my address, need to update', true],
  ['medical card', 'i need my medical card for hospital admission', true],
  ['letter', 'i need a letter of insurance for my visa application', true],
  ['giro bounced', 'my giro didnt go through this month', true],
  ['buy more', 'im thinking of getting more coverage', true],
  ['cancel', 'i want to cancel my policy', true],
  ['newborn', 'we just had a baby, want to cover him', true],
  ['is covered', 'is knee surgery covered before i book it', true],
  ['overseas', 'im relocating to australia, how does that affect my coverage', true],
  ['premium up', 'my premium went up, should i keep this plan', true],
  ['congrats', 'i just got married!', true],
  ['unhappy', 'im quite upset about how this was handled', true],
  // Should stay SILENT — nothing to do with the trained scope
  ['OFF: car', 'can you help me fix my car engine', false],
  ['OFF: weather', 'what is the weather like today', false],
  ['OFF: food', 'what should i eat for lunch', false],
  ['OFF: chitchat', 'haha ok see you later', false],
  ['OFF: random', 'do you sell air conditioners', false],
];

async function ask(body: string) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Group-Bridge-Token': TOKEN },
    body: JSON.stringify({ organizationId: ORG, groupId: 'tmpl-test@g.us', from: '6591151041', body }),
  });
  const json: any = await res.json().catch(() => ({}));
  const d = json?.data ?? json;
  return { reply: d?.reply || null, confidence: d?.confidence, reason: d?.reason };
}

async function main() {
  let pass = 0;
  const fails: string[] = [];
  for (const [label, msg, expectReply] of CASES) {
    try {
      const { reply, confidence } = await ask(msg);
      const got = !!reply;
      const ok = got === expectReply;
      if (ok) pass++;
      else fails.push(`${label}: expected ${expectReply ? 'REPLY' : 'SILENT'}, got ${got ? 'REPLY' : 'SILENT'}`);
      const mark = ok ? '✅' : '❌';
      const shown = reply ? reply.replace(/\n/g, ' ').slice(0, 68) + '…' : 'SILENT';
      console.log(`${mark} ${label.padEnd(14)} ${got ? `(${((confidence ?? 0) * 100).toFixed(0)}%)` : '     '} ${shown}`);
    } catch (e: any) {
      fails.push(`${label}: ERROR ${e.message}`);
      console.log(`❌ ${label.padEnd(14)} ERROR ${e.message}`);
    }
  }
  console.log(`\n${pass}/${CASES.length} behaved as expected`);
  if (fails.length) {
    console.log('\nMismatches:');
    fails.forEach((f) => console.log('  • ' + f));
  }
}

main();
