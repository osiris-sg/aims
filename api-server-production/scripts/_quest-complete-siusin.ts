/**
 * Ms. Siusin project (ba899165): mark quest steps 1-9 done so the carpentry
 * step (10) becomes the active one, and remove the test data — the test
 * photo attached to step 10 (DB + S3) and the test QuestMediaRequests for
 * guru's number.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_quest-complete-siusin.ts
 */
import { PrismaClient } from '@prisma/client';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const PROJECT = 'ba899165-dd69-4f8b-9018-2b35aff65f02';

async function main() {
  const done = await prisma.projectQuestStep.updateMany({
    where: { projectId: PROJECT, stepNo: { lte: 9 }, status: 'pending' },
    data: { status: 'done', completedAt: new Date(), completedByName: 'backfill' },
  });
  console.log(`✔ steps 1-9: ${done.count} marked done`);

  const step10 = await prisma.projectQuestStep.findFirst({ where: { projectId: PROJECT, stepNo: 10 } });
  const atts: any[] = Array.isArray(step10?.attachments) ? (step10!.attachments as any[]) : [];
  if (atts.length) {
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } });
    const bucket = process.env.RESOURCE_BUCKET || 'aims-osiris';
    for (const a of atts) {
      if (a?.key) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: a.key })).then(() => console.log('🗑 S3', a.key)).catch((e) => console.log('S3 delete failed:', e.message));
    }
    await prisma.projectQuestStep.update({ where: { id: step10!.id }, data: { attachments: [] as any } });
    console.log(`✔ step 10 test attachments cleared (${atts.length})`);
  } else {
    console.log('step 10 has no attachments');
  }

  const reqs = await prisma.questMediaRequest.deleteMany({ where: { waNumber: '6591151041' } });
  console.log(`✔ test QuestMediaRequests deleted: ${reqs.count}`);

  const steps = await prisma.projectQuestStep.findMany({ where: { projectId: PROJECT }, orderBy: { stepNo: 'asc' }, select: { stepNo: true, title: true, status: true } });
  console.log(steps.map((s) => `${s.stepNo}. [${s.status}] ${s.title}`).join('\n'));
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
