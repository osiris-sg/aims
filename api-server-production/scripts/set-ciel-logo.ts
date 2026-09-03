/**
 * CIEL INTERIOR logo → S3 + Organization.logo (guru 2026-09-03).
 *
 * Uploads ~/Downloads/Original_Black.png once to the shared resource bucket
 * (key organizations/ciel-interior/logo-black.png — same URL serves every env)
 * and points the CIEL org's logo at it. The renderers already read
 * Organization.logo: ID quotation + VO brand blocks, invoice header (added
 * 2026-09-03), and new documents seed config.logo from it.
 *
 * Run per env:
 *   npx dotenv -e .env -- npx ts-node scripts/set-ciel-logo.ts
 *   npx dotenv -e .env.staging -- npx ts-node scripts/set-ciel-logo.ts
 *   npx dotenv -e .env.production -- npx ts-node scripts/set-ciel-logo.ts
 */
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';

const prisma = new PrismaClient();
const ORG_NAME = 'CIEL INTERIOR PTE. LTD.';
const FILE = `${process.env.HOME}/Downloads/Original_Black.png`;
const BUCKET = process.env.RESOURCE_BUCKET || 'aims-osiris';
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const KEY = 'organizations/ciel-interior/logo-black.png';

async function main() {
  const s3 = new S3Client({ region: REGION });
  const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${KEY}`;

  // Upload once — later env runs just point their DB at the same object.
  const exists = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: KEY })).then(() => true).catch(() => false);
  if (!exists) {
    const body = fs.readFileSync(FILE);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: KEY, Body: body, ContentType: 'image/png' }));
    console.log(`⬆ uploaded ${body.length} bytes → ${url}`);
  } else {
    console.log(`  already in S3: ${url}`);
  }

  const org = await prisma.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true, logo: true } });
  if (!org) throw new Error(`${ORG_NAME} not found in this DB`);
  await prisma.organization.update({ where: { id: org.id }, data: { logo: url } });
  console.log(`✅ ${ORG_NAME} logo set${org.logo ? ` (was: ${org.logo})` : ''}`);
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
