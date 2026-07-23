/** Update Xero JP drafts: external (ref'd) bills 442→443; push the 22 new
 *  bills with the correct account; all NoTax. */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const XERO_API = 'https://api.xero.com/api.xro/2.0';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function tokens() {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId: ORG } });
  if (!conn) throw new Error('no conn');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const envTxt = fs.readFileSync('.env.production', 'utf8');
  const basic = Buffer.from(`${envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1]}:${envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1]}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}
let TK: any;
async function xero(method: string, path: string, body?: any) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(`${XERO_API}${path}`, { method, headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get('Retry-After') || '60', 10); console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  throw new Error('gave up');
}
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
const pdfParse = require('pdf-parse');
const envTxt2 = fs.readFileSync('.env.production', 'utf8');
const g = (k: string) => envTxt2.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1];
const s3 = new S3Client({ region: g('AWS_REGION') || 'ap-southeast-1', credentials: { accessKeyId: g('AWS_ACCESS_KEY_ID')!, secretAccessKey: g('AWS_SECRET_ACCESS_KEY')! } });
const BUCKET = g('RESOURCE_BUCKET') || 'aims-osiris';

function extractEmployer(text: string, sponsor?: string): string | null {
  let m = text.match(/Pass Office-\d+\n(.+)\n(.+)\nPrice payable includes GST/);
  if (m) return m[1].trim();
  // fallback: line right before the sponsor name
  if (sponsor) {
    const lines = text.split('\n').map(l => l.trim());
    const i = lines.findIndex(l => l.toUpperCase() === sponsor.toUpperCase());
    if (i > 0) return lines[i - 1];
  }
  // fallback: PAYMENT ADVICE block — 2nd value line after the "Invoice No." label
  m = text.match(/Invoice No\.\n(.+)\n(.+)\n/);
  if (m) return m[2].trim();
  return null;
}

async function main() {
  TK = await tokens();
  const bills = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } },
    select: { id: true, name: true, config: true, attachments: true },
  });
  const targets = bills.filter(b => !((b.config as any)?.reference || '').startsWith('BIPL-JPSG'));
  console.log(`bills without invoice ref: ${targets.length}`);
  const updates: Array<{ id: string; name: string; xeroBillId: string | null; employer: string }> = [];
  let noPdf = 0, noEmployer = 0;
  for (const b of targets) {
    const att = Array.isArray(b.attachments) ? (b.attachments as any[])[0] : null;
    if (!att?.fileKey) { noPdf++; continue; }
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: att.fileKey }));
      const buf = Buffer.from(await res.Body!.transformToByteArray());
      const { text } = await pdfParse(buf);
      const c: any = b.config || {};
      const sponsor = ((c.lines || [])[0]?.description || '').match(/Sponsor:\s*(.+)$/)?.[1]?.trim();
      const employer = extractEmployer(text, sponsor);
      if (!employer) { noEmployer++; console.log(`  ? no employer: ${b.name}`); continue; }
      updates.push({ id: b.id, name: b.name, xeroBillId: c.xeroBillId || null, employer });
    } catch (e: any) { noPdf++; console.log(`  ? pdf fail ${b.name}: ${e.message.slice(0, 60)}`); }
  }
  console.log(`extracted: ${updates.length} · no-pdf: ${noPdf} · no-employer: ${noEmployer}`);
  const byEmployer = new Map<string, number>();
  updates.forEach(u => byEmployer.set(u.employer, (byEmployer.get(u.employer) || 0) + 1));
  console.log('employers:', [...byEmployer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));

  // AIMS refs
  for (const u of updates) {
    const d = await prisma.document.findUnique({ where: { id: u.id }, select: { config: true } });
    const c: any = d!.config || {};
    await prisma.document.update({ where: { id: u.id }, data: { config: { ...c, reference: `${u.name} (${u.employer})` } } });
  }
  console.log('AIMS refs stamped');

  // Xero: bill UI "Reference" box = API InvoiceNumber
  let ok = 0, failed = 0;
  const linked = updates.filter(u => u.xeroBillId);
  for (let i = 0; i < linked.length; i += 40) {
    const chunk = linked.slice(i, i + 40);
    const res = await xero('POST', '/Invoices?SummarizeErrors=false', {
      Invoices: chunk.map(u => ({ InvoiceID: u.xeroBillId, InvoiceNumber: `${u.name} (${u.employer})` })),
    });
    for (const inv of res.Invoices || []) {
      if (inv.HasErrors) { failed++; console.log(`  x ${inv.InvoiceNumber}: ${inv.ValidationErrors?.[0]?.Message}`); } else ok++;
    }
    await sleep(1100);
  }
  console.log(`DONE xero refs: ${ok} failed: ${failed} (unlinked: ${updates.length - linked.length})`);
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
