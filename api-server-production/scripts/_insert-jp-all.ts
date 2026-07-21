/** Full JP Pass import into PROD + account-442 normalization (guru-approved).
 *  1) Insert every parsed zip bill not already in prod: acct 442, no tax,
 *     DRAFT, real bill date, source PDF uploaded to S3 + attached.
 *  2) Set account 442 on ALL existing JP bill lines (email-ingested ones). */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const SUPPLIER_ID = '647eb442-5446-4d2f-98ca-e0db3bd8296c';
const TEMPLATE_ID = '2399e9ab-b922-4b07-afaf-28a6036c5bae';
const SP = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad/jp-bills';
const DIR = path.join(SP, 'JP Pass application invoices 14072026');
const envTxt = fs.readFileSync('.env.production', 'utf8');
const get = (k: string) => envTxt.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1];
const dbUrl = new URL(get('DATABASE_URL')!); dbUrl.searchParams.delete('pool_timeout'); dbUrl.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: dbUrl.toString() }) } as any);
const s3 = new S3Client({ region: get('AWS_REGION')!, credentials: { accessKeyId: get('AWS_ACCESS_KEY_ID')!, secretAccessKey: get('AWS_SECRET_ACCESS_KEY')! } });
const BUCKET = get('RESOURCE_BUCKET')!;
const TRANSIENT = /Connection terminated|closed the connection|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i;
process.on('uncaughtException', (e: any) => { if (TRANSIENT.test(e?.message || '')) { console.warn('  ⚠ transient swallowed'); return; } throw e; });
async function retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e: any) {
      if (!TRANSIENT.test(e?.message || '') || i >= 4) throw e;
      await new Promise((r) => setTimeout(r, [2, 5, 15, 60][i] * 1000));
    }
  }
}
async function main() {
  const acct = await p.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '442' }, select: { id: true } });
  if (!acct) throw new Error('no 442');
  const parsed: any[] = JSON.parse(fs.readFileSync(path.join(SP, 'jp-parsed.json'), 'utf8'));
  const existing = new Set((await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { name: true } })).map(d => d.name));
  const fresh = parsed.filter(b => !existing.has(b.num));
  console.log(`parsed=${parsed.length} already=${parsed.length - fresh.length} to-insert=${fresh.length}`);

  let created = 0, failed = 0;
  for (const b of fresh) {
    try {
      const iso = new Date(b.date + ' 12:00 UTC');
      const dateStr = iso.toISOString().slice(0, 10);
      const fileKey = `jp-pass-import/${ORG}/${b.file}`;
      await retry(() => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: fileKey, Body: fs.readFileSync(path.join(DIR, b.file)), ContentType: 'application/pdf' })), 's3');
      const config = {
        date: `${dateStr}T00:00:00.000Z`, billDate: dateStr, dueDate: dateStr,
        supplierId: SUPPLIER_ID, supplier: { id: SUPPLIER_ID, name: 'Jurong Port Pte Ltd' },
        lines: [{
          description: `Administrative Fee - ${b.days} Days for ${b.qty} Applications (Pass Duration: ${b.duration}) — Sponsor: ${b.sponsor}`,
          quantity: b.qty, unitPrice: b.unit, amount: b.total, accountId: acct.id,
        }],
        subtotal: b.total, taxAmount: 0, totalAmount: b.total, amountPaid: 0,
        amountsAre: 'NO_TAX', billStatus: 'DRAFT', inboundChannel: 'MANUAL', currency: 'SGD',
        reference: 'JP Pass application', documentInfo: { currency: 'SGD' },
      };
      await retry(() => p.document.create({
        data: {
          organizationId: ORG, documentTemplateId: TEMPLATE_ID, name: b.num, type: 'BILL', status: 'draft' as any,
          createdAt: new Date(`${dateStr}T00:00:00.000Z`),
          config: config as unknown as Prisma.InputJsonValue,
          attachments: [{ label: 'JP Pass invoice (import)', fileKey, fileName: b.file, mimeType: 'application/pdf', uploadedAt: new Date().toISOString(), uploadedBy: 'jp-pass-import' }] as unknown as Prisma.InputJsonValue,
        },
      }), 'create');
      created++;
      if (created % 20 === 0) console.log(`  inserted ${created}/${fresh.length}`);
    } catch (e: any) {
      failed++;
      console.log(`  ✗ ${b.num}: ${(e?.message || '').slice(-120)}`);
    }
  }
  console.log(`\ninsert done: created=${created} failed=${failed}`);

  // 2) Normalize account on ALL JP bills.
  const all = await p.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  let fixed = 0, already = 0;
  for (const d of all) {
    const c: any = d.config || {};
    const lines: any[] = c.lines || [];
    if (!lines.length) continue;
    if (lines.every((l) => l.accountId === acct.id)) { already++; continue; }
    await retry(() => p.document.update({ where: { id: d.id }, data: { config: { ...c, lines: lines.map((l) => ({ ...l, accountId: acct.id })) } as unknown as Prisma.InputJsonValue } }), 'acct fix');
    fixed++;
  }
  console.log(`account 442 normalization: fixed=${fixed} already-442=${already} total-jp=${all.length}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => p.$disconnect());
