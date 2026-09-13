/**
 * Insert the "Carpentry installation — before video & photo" quest step as
 * step 10 (between "Elevation drawings confirmed" 9 and "95% complete" 10)
 * for every project whose quest is already seeded. Shifts 11→12 and 10→11
 * first. Idempotent — skips projects that already have the step.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_quest-insert-carpentry-step.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_STEP = {
  stepNo: 10,
  title: 'Carpentry installation — before video & photo',
  description:
    'On the day carpentry installation starts, the designer gets a 9am WhatsApp asking for a BEFORE video and photo of the site — whatever they send back attaches here automatically.',
  requiresProof: true,
};

async function main() {
  const seeded = await prisma.projectQuestStep.groupBy({ by: ['projectId', 'organizationId'], _count: true });
  for (const g of seeded) {
    const has = await prisma.projectQuestStep.findFirst({
      where: { projectId: g.projectId, title: { startsWith: 'Carpentry installation' } },
      select: { id: true },
    });
    if (has) {
      console.log(`↷ ${g.projectId} already has the step`);
      continue;
    }
    // Shift from the top down so the (projectId, stepNo) unique never collides.
    await prisma.projectQuestStep.updateMany({ where: { projectId: g.projectId, stepNo: 11 }, data: { stepNo: 12 } });
    await prisma.projectQuestStep.updateMany({ where: { projectId: g.projectId, stepNo: 10 }, data: { stepNo: 11 } });
    await prisma.projectQuestStep.create({ data: { organizationId: g.organizationId, projectId: g.projectId, ...NEW_STEP } });
    console.log(`✔ ${g.projectId} — step 10 inserted (${g._count} → ${g._count + 1} steps)`);
  }
  console.log('done');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
