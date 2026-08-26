/**
 * Give the PA's hand/person emojis a light skin tone so replies match how the
 * advisor's team actually writes. WhatsApp renders a bare 🙏 as the yellow
 * default; appending U+1F3FB selects the light tone.
 *
 * Dry run by default:
 *   npx ts-node -r dotenv/config --transpile-only scripts/set-pa-emoji-skin-tone.ts dotenv_config_path=.env.production
 *   ... --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = process.env.PA_ORG_ID || 'ad9127a7-cbc4-4108-b014-8b32123a5362'; // Denzel Office
const APPLY = process.argv.includes('--apply');

const LIGHT = '\u{1F3FB}';
// Emoji that support a skin-tone modifier and appear in the PA's wording.
const TONEABLE = ['\u{1F64F}', '\u{1F64C}', '\u{1F44D}', '\u{1F44B}', '\u{1F44F}', '\u{1F91D}'];
const TONES = /[\u{1F3FB}-\u{1F3FF}]/u;

/** Add the light tone to any toneable emoji that has no tone yet. */
function applyTone(text: string): string {
  let out = text;
  for (const e of TONEABLE) {
    // Only when not already followed by a tone modifier.
    out = out.replace(new RegExp(`${e}(?![\\u{1F3FB}-\\u{1F3FF}])`, 'gu'), e + LIGHT);
  }
  return out;
}

async function main() {
  const pairs = await prisma.whatsAppQnA.findMany({
    where: { organizationId: ORG },
    select: { id: true, question: true, answer: true },
  });
  const config = await prisma.whatsAppAgentConfig.findUnique({
    where: { organizationId: ORG },
    select: { aiGuidance: true, autoSendGuidance: true },
  });

  let changed = 0;
  for (const p of pairs) {
    const next = applyTone(p.answer);
    if (next === p.answer) continue;
    changed++;
    console.log(`${APPLY ? '' : '[dry-run] '}${p.question.slice(0, 50)}`);
    if (APPLY) await prisma.whatsAppQnA.update({ where: { id: p.id }, data: { answer: next } });
  }

  // Keep the tone instruction in the agent's guidance so newly generated
  // wording matches the templates.
  const note =
    'When you use hand or gesture emoji (such as the folded hands), always use the light skin tone variant, never the default yellow.';
  if (config?.aiGuidance && !config.aiGuidance.includes('light skin tone')) {
    console.log(`${APPLY ? '' : '[dry-run] '}append skin-tone instruction to aiGuidance`);
    if (APPLY) {
      await prisma.whatsAppAgentConfig.update({
        where: { organizationId: ORG },
        data: { aiGuidance: `${config.aiGuidance}\n\n${note}` },
      });
    }
  }

  console.log(`\n${changed} of ${pairs.length} answers ${APPLY ? 'updated' : 'would change'}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
