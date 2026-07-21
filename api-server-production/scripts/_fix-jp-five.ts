/** Trial-batch fixes per guru: attach source PDF (S3) + account 442. */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const DIR = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad/jp-bills/JP Pass application invoices 14072026';

// prod env: DB + AWS
const envTxt = fs.readFileSync('.env.production', 'utf8');
const get = (k: string) => envTxt.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1];
const dbUrl = new URL(get('DATABASE_URL')!); dbUrl.searchParams.delete('pool_timeout'); dbUrl.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: dbUrl.toString() }) } as any);
const s3 = new S3Client({ region: get('AWS_REGION') || 'ap-southeast-1', credentials: { accessKeyId: get('AWS_ACCESS_KEY_ID')!, secretAccessKey: get('AWS_SECRET_ACCESS_KEY')! } });
const BUCKET = get('RESOURCE_BUCKET') || 'aims-osiris';

const NUMS = ['JP2604150047', 'JP2604150059', 'JP2604150065', 'JP2604150121', 'JP2604150122'];

async function main() {
  const acct442 = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '442' }, select: { id: true, name: true } });
  if (!acct442) throw new Error('account 442 not found in prod');
  console.log(`account 442 = ${acct442.name} (${acct442.id})`);
  const files = fs.readdirSync(DIR);
  for (const num of NUMS) {
    const file = files.find((f) => f.startsWith(num + '_'));
    if (!file) { console.log(`  ✗ ${num}: pdf not found in zip`); continue; }
    const doc = await p.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name: num }, select: { id: true, config: true, attachments: true } });
    if (!doc) { console.log(`  ✗ ${num}: bill not in prod`); continue; }

    // 1) upload PDF
    const fileKey = `jp-pass-import/${ORG}/${file}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: fileKey, Body: fs.readFileSync(path.join(DIR, file)), ContentType: 'application/pdf' }));

    // 2) attach + switch account to 442
    const c: any = doc.config || {};
    const lines = (c.lines || []).map((l: any) => ({ ...l, accountId: acct442.id }));
    const attachments = [
      ...(Array.isArray(doc.attachments) ? (doc.attachments as any[]) : []),
      { label: 'JP Pass invoice (import)', fileKey, fileName: file, mimeType: 'application/pdf', uploadedAt: new Date().toISOString(), uploadedBy: 'jp-pass-import' },
    ];
    await p.document.update({
      where: { id: doc.id },
      data: { config: { ...c, lines } as unknown as Prisma.InputJsonValue, attachments: attachments as unknown as Prisma.InputJsonValue },
    });
    console.log(`  ✓ ${num}: pdf uploaded + attached, account → 442`);
  }
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => p.$disconnect());
