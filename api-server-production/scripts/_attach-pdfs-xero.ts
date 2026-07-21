/** Attach each JP bill's original PDF to its Xero draft
 *  (PUT /Invoices/{id}/Attachments/{filename}). */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const XERO_API = 'https://api.xero.com/api.xro/2.0';
const DIR = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad/jp-bills/JP Pass application invoices 14072026';
const envTxt = fs.readFileSync('.env.production', 'utf8');
const get = (k: string) => envTxt.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1];
const dbUrl = new URL(get('DATABASE_URL')!); dbUrl.searchParams.delete('pool_timeout'); dbUrl.searchParams.delete('connect_timeout');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: dbUrl.toString() }) } as any);
const s3 = new S3Client({ region: get('AWS_REGION')!, credentials: { accessKeyId: get('AWS_ACCESS_KEY_ID')!, secretAccessKey: get('AWS_SECRET_ACCESS_KEY')! } });
const BUCKET = get('RESOURCE_BUCKET')!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function tokens() {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId: ORG } });
  if (!conn) throw new Error('no conn');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const basic = Buffer.from(`${get('XERO_CLIENT_ID')}:${get('XERO_CLIENT_SECRET')}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}
async function pdfFor(name: string, attachments: any): Promise<{ buf: Buffer; fname: string } | null> {
  const local = fs.readdirSync(DIR).find(f => f.startsWith(name + '_'));
  if (local) return { buf: fs.readFileSync(path.join(DIR, local)), fname: local };
  const att = (Array.isArray(attachments) ? attachments : []).find((a: any) => a.mimeType === 'application/pdf' && a.fileKey);
  if (!att) return null;
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: att.fileKey }));
  const bytes = await obj.Body!.transformToByteArray();
  return { buf: Buffer.from(bytes), fname: att.fileName || `${name}.pdf` };
}
async function main() {
  let tk = await tokens();
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true, attachments: true } });
  const todo = bills.filter(b => (b.config as any)?.xeroBillId && !(b.config as any)?.xeroPdfAttached);
  console.log(`bills with xero link: ${todo.length}`);
  let ok = 0, failed = 0, noPdf = 0, n = 0;
  for (const b of todo) {
    n++;
    if (n % 30 === 0) { tk = await tokens(); console.log(`  progress ${n}/${todo.length} (ok=${ok})`); }
    const c: any = b.config;
    try {
      const pdf = await pdfFor(b.name!, b.attachments);
      if (!pdf) { noPdf++; continue; }
      const res = await fetch(`${XERO_API}/Invoices/${c.xeroBillId}/Attachments/${encodeURIComponent(pdf.fname)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tk.at}`, 'Xero-Tenant-Id': tk.tid, Accept: 'application/json', 'Content-Type': 'application/pdf' },
        body: new Uint8Array(pdf.buf),
      });
      if (res.status === 429) { const w = parseInt(res.headers.get('Retry-After') || '60', 10); await sleep(w * 1000); n--; continue; }
      if (!res.ok) { failed++; if (failed <= 5) console.log(`  ✗ ${b.name}: ${res.status} ${(await res.text()).slice(0, 100)}`); continue; }
      await prisma.document.update({ where: { id: b.id }, data: { config: { ...c, xeroPdfAttached: true } as any } });
      ok++;
    } catch (e: any) {
      failed++;
      if (failed <= 5) console.log(`  ✗ ${b.name}: ${(e?.message || '').slice(0, 100)}`);
    }
    await sleep(1100);
  }
  console.log(`\nattached: ${ok} failed: ${failed} no-pdf: ${noPdf}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
