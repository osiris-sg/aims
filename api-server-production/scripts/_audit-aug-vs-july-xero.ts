// Formatting audit (guru 2026-08-18): for each of the 71 August drafts in
// Xero, compare its line formatting against the JULY counterpart in Xero —
// line count, per-line amount + account code, and description shape
// (digits masked, so period/serial/nth changes don't false-positive).
// Read-only: prints a report, changes nothing.
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production'), override: true });
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const TF = path.resolve(__dirname, '_xero2-tokens.json');

async function tokens() {
  const t = JSON.parse(fs.readFileSync(TF, 'utf8'));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return t;
  const basic = Buffer.from(t.clientId + ':' + t.clientSecret).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + basic }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }) });
  if (!res.ok) throw new Error('app2 refresh ' + res.status);
  const j: any = await res.json();
  const nt = { ...t, accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 };
  fs.writeFileSync(TF, JSON.stringify(nt, null, 2));
  return nt;
}

const shape = (s: string) => (s || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 45);
const R2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  // pair each pushed Aug doc with its July source
  const docs = await p.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, select: { id: true, name: true, config: true } });
  const aug = docs.filter((d) => (d.config as any)?.xeroSyncedBy === 'app2-recurring-push');
  const tpls = await p.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG, lastRunDocumentId: { not: null } }, select: { sourceDocumentId: true, lastRunDocumentId: true } });
  const srcByGen = new Map(tpls.map((t) => [t.lastRunDocumentId!, t.sourceDocumentId!]));
  const byId = new Map(docs.map((d) => [d.id, d]));
  const obayashiJuly = docs.find((d) => d.name === 'BI202607012');

  type Pair = { augName: string; julyName: string; augXid: string; julyXid: string };
  const pairs: Pair[] = [];
  for (const d of aug) {
    const srcId = srcByGen.get(d.id) || (d.name === 'BI202608009' ? obayashiJuly?.id : null);
    const src = srcId ? byId.get(srcId) : null;
    if (!src || !(src.config as any)?.xeroInvoiceId) { console.log('NO JULY PAIR:', d.name); continue; }
    pairs.push({ augName: d.name!, julyName: src.name!, augXid: (d.config as any).xeroInvoiceId, julyXid: (src.config as any).xeroInvoiceId });
  }
  console.log('pairs:', pairs.length);

  // fetch all from Xero with line items
  const t: any = await tokens();
  const lines = new Map<string, any[]>();
  const allIds = [...new Set(pairs.flatMap((pr) => [pr.augXid, pr.julyXid]))];
  for (let i = 0; i < allIds.length; i += 40) {
    const r = await fetch('https://api.xero.com/api.xro/2.0/Invoices?IDs=' + allIds.slice(i, i + 40).join(',') + '&page=1', { headers: { Authorization: 'Bearer ' + t.accessToken, 'Xero-Tenant-Id': t.tenantId, Accept: 'application/json' } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('xero batch ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    for (const inv of j.Invoices || []) lines.set(inv.InvoiceID, inv.LineItems || []);
  }

  let ok = 0;
  const issues: string[] = [];
  for (const pr of pairs.sort((a, b) => a.augName.localeCompare(b.augName))) {
    const jl = lines.get(pr.julyXid), al = lines.get(pr.augXid);
    if (!jl || !al) { issues.push(`${pr.augName}: missing from Xero fetch`); continue; }
    const probs: string[] = [];
    if (jl.length !== al.length) probs.push(`lines ${al.length} vs July ${jl.length}`);
    const n = Math.min(jl.length, al.length);
    for (let i = 0; i < n; i++) {
      const J = jl[i], A = al[i];
      if (R2(Number(A.LineAmount) || 0) !== R2(Number(J.LineAmount) || 0)) probs.push(`L${i + 1} amt ${A.LineAmount} vs ${J.LineAmount}`);
      if (String(A.AccountCode || '') !== String(J.AccountCode || '')) probs.push(`L${i + 1} acct ${A.AccountCode || '—'} vs ${J.AccountCode || '—'}`);
      if (shape(A.Description) !== shape(J.Description)) probs.push(`L${i + 1} desc "${shape(A.Description).slice(0, 28)}" vs "${shape(J.Description).slice(0, 28)}"`);
    }
    if (!probs.length) ok++;
    else issues.push(`${pr.augName} (July ${pr.julyName}): ${probs.slice(0, 4).join(' | ')}${probs.length > 4 ? ` (+${probs.length - 4} more)` : ''}`);
  }
  console.log(`\nMATCH July formatting: ${ok}/${pairs.length}`);
  console.log(`MISMATCH: ${issues.length}`);
  issues.forEach((i) => console.log(' ✗', i));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
