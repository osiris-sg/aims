// One-off: replace the condition photos on ONE DO_START proof report.
//   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_replace-do-start-photos.ts <reportId> [--dry-run] -- <file.jpg> ...
// Uploads each file to the resource bucket under a fresh do-start/<id>.jpg key
// (the OLD objects are left in S3 untouched so this is reversible — the old key
// list is printed before the write), then points the report's `photos` array at
// the new keys. --dry-run uploads NOTHING and writes NOTHING.
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const sep = argv.indexOf('--');
const reportId = argv[0];
const files = sep >= 0 ? argv.slice(sep + 1) : [];
if (!reportId || files.length === 0) {
  console.error('usage: <reportId> [--dry-run] -- <file> ...');
  process.exit(1);
}

const prisma = new PrismaClient();
const bucket = process.env.RESOURCE_BUCKET!;
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! },
});

(async () => {
  const report = await prisma.maintenanceServiceReport.findUnique({
    where: { id: reportId },
    select: { id: true, kind: true, photos: true, documentId: true, organizationId: true },
  });
  if (!report) throw new Error(`report ${reportId} not found`);
  console.log(`report ${report.id} kind=${report.kind} doc=${report.documentId}`);
  console.log(`OLD photos (kept in S3 for rollback): ${JSON.stringify(report.photos)}`);

  const newKeys: string[] = [];
  for (const f of files) {
    const key = `do-start/${randomUUID().slice(0, 8)}.jpg`;
    const body = readFileSync(f);
    console.log(`${dry ? '[dry] would upload' : 'uploading'} ${f} (${body.length} bytes) -> s3://${bucket}/${key}`);
    if (!dry) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/jpeg' }));
    }
    newKeys.push(key);
  }
  console.log(`NEW photos: ${JSON.stringify(newKeys)}`);
  if (dry) {
    console.log('[dry] no DB write');
  } else {
    await prisma.maintenanceServiceReport.update({ where: { id: reportId }, data: { photos: newKeys } });
    console.log('DB updated');
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
