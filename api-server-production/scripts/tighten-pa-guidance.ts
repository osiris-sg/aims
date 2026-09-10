/**
 * Two live faults seen in a real client group:
 *   - the PA opened "Hi Gordon!" when Clarice was the one writing (it inferred
 *     a name from other people in the group history)
 *   - it used an em dash, which guru has banned in client-facing copy
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/tighten-pa-guidance.ts dotenv_config_path=.env.production
 *   ... --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG = 'ad9127a7-cbc4-4108-b014-8b32123a5362'; // Denzel Office
const APPLY = process.argv.includes('--apply');

const RULES = [
  'NEVER address anyone by name unless you are certain it is the person who just wrote. Group chats contain several people, and guessing produces replies that greet the wrong person. When in any doubt, greet with no name at all ("Hi there!" or just start the sentence).',
  'NEVER use em dashes or en dashes. Use a comma, a full stop, or start a new sentence.',
  'NEVER state anything about where Denzel is, what he is doing, or when he will arrive unless the conversation has explicitly said so. Do not invent status updates.',
];

async function main() {
  const config = await prisma.whatsAppAgentConfig.findUnique({
    where: { organizationId: ORG },
    select: { aiGuidance: true },
  });
  if (!config?.aiGuidance) throw new Error('No agent guidance found for this org');

  const missing = RULES.filter((r) => !config.aiGuidance!.includes(r.slice(0, 40)));
  if (!missing.length) {
    console.log('All rules already present.');
    return;
  }
  const next = `${config.aiGuidance}\n\n${missing.join('\n')}`;
  for (const r of missing) console.log(`${APPLY ? '+' : '[dry-run] +'} ${r.slice(0, 80)}…`);

  if (APPLY) {
    await prisma.whatsAppAgentConfig.update({ where: { organizationId: ORG }, data: { aiGuidance: next } });
    console.log(`\n✅ guidance updated (${next.length} chars)`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
