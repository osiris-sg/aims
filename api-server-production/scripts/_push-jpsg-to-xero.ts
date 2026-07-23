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
async function main() {
  TK = await tokens();
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, name: { startsWith: 'BIPL-JPSG-INV' }, type: { in: ['INVOICE', 'CREDIT_NOTE'] } },
    select: { id: true, name: true, type: true, config: true },
  });
  const unpushed = docs.filter(d => { const c: any = d.config || {}; return !c.xeroInvoiceId && !c.xeroCreditNoteId; });
  const invs = unpushed.filter(d => d.type === 'INVOICE');
  const cns = unpushed.filter(d => d.type === 'CREDIT_NOTE');
  console.log(`unpushed: ${invs.length} invoices, ${cns.length} credit notes`);

  // contacts
  const custIds = Array.from(new Set(unpushed.map(d => (d.config as any)?.customerId).filter(Boolean)));
  const custs = await prisma.customer.findMany({ where: { id: { in: custIds as string[] } }, select: { id: true, name: true, xeroId: true } });
  const custById = new Map(custs.map(c => [c.id, c]));
  const contactFor = (d: any) => {
    const cid = (d.config as any)?.customerId;
    const c = cid ? custById.get(cid) : null;
    if (c?.xeroId) return { ContactID: c.xeroId };
    const nm = c?.name || (d.config as any)?.customerName || (d.config as any)?.customer?.name;
    return nm ? { Name: nm } : null;
  };
  const linesFor = (c: any) => ((c.items || []) as any[]).map(it => {
    const qty = Number(it.quantity) || 0, unit = Number(it.unitPrice) || 0, amt = Number(it.amount) || 0;
    // zero-amount rows (e.g. the JP bill-number listing) go as description-only
    // lines so Xero leaves Qty/Price/Amount blank instead of showing 0.00
    if (amt === 0 && unit === 0) return { Description: it.description || '' };
    const ok = qty > 0 && Math.abs(qty * unit - amt) < 0.01;
    return { Description: it.description || 'Jurong Port Pass Application', Quantity: ok ? qty : 1, UnitAmount: ok ? unit : amt, AccountCode: '443', TaxType: 'NONE' };
  });

  // idempotency pre-check for invoices (Xero allows duplicate numbers)
  const existingByNum = new Map<string, string>();
  for (let i = 0; i < invs.length; i += 40) {
    const nums = invs.slice(i, i + 40).map(d => d.name).join(',');
    const res = await xero('GET', `/Invoices?InvoiceNumbers=${encodeURIComponent(nums)}`);
    for (const inv of res.Invoices || []) existingByNum.set(inv.InvoiceNumber, inv.InvoiceID);
    await sleep(1100);
  }
  console.log(`already in Xero: ${existingByNum.size}`);

  let pushed = 0, stamped = 0, failed = 0;
  const toStamp = invs.filter(d => existingByNum.has(d.name));
  for (const d of toStamp) {
    const c: any = d.config || {};
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, xeroInvoiceId: existingByNum.get(d.name), xeroStatus: 'DRAFT', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } } });
    stamped++;
  }
  const toPush = invs.filter(d => !existingByNum.has(d.name));
  for (let i = 0; i < toPush.length; i += 40) {
    const chunk = toPush.slice(i, i + 40);
    const payload = { Invoices: chunk.map(d => { const c: any = d.config || {}; const di: any = c.documentInfo || {}; const date = di.date || '2026-07-01';
      return { Type: 'ACCREC', Contact: contactFor(d), InvoiceNumber: d.name, Reference: di.reference || di.referenceNo || undefined, Date: date, DueDate: di.dueDate || date, Status: 'DRAFT', LineAmountTypes: 'NoTax', LineItems: linesFor(c) };
    }) };
    const res = await xero('POST', '/Invoices?SummarizeErrors=false', payload);
    for (const inv of res.Invoices || []) {
      const d = chunk.find(x => x.name === inv.InvoiceNumber);
      if (!d) continue;
      if (inv.HasErrors) { failed++; console.log(`  x ${inv.InvoiceNumber}: ${inv.ValidationErrors?.[0]?.Message}`); continue; }
      const c: any = d.config || {};
      await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, xeroInvoiceId: inv.InvoiceID, xeroStatus: inv.Status, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } } });
      pushed++;
    }
    console.log(`invoices: pushed=${pushed} stamped=${stamped} failed=${failed}`);
    await sleep(1100);
  }

  // credit notes — reference carries the credited invoice number (allocation
  // needs both docs approved; done later in Xero)
  let cnPushed = 0, cnFailed = 0;
  for (const d of cns) {
    const c: any = d.config || {}; const di: any = c.documentInfo || {};
    const chk = await xero('GET', `/CreditNotes?where=${encodeURIComponent(`CreditNoteNumber=="${d.name}"`)}`);
    const found = (chk.CreditNotes || [])[0];
    if (found) {
      await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, xeroCreditNoteId: found.CreditNoteID, xeroStatus: found.Status, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } } });
      console.log(`  = CN ${d.name} already in Xero`); continue;
    }
    await sleep(1100);
    const res = await xero('POST', '/CreditNotes?SummarizeErrors=false', { CreditNotes: [{ Type: 'ACCRECCREDIT', Contact: contactFor(d), CreditNoteNumber: d.name, Reference: di.reference || undefined, Date: di.date || '2026-07-01', Status: 'DRAFT', LineAmountTypes: 'NoTax', LineItems: linesFor(c) }] });
    const cn = (res.CreditNotes || [])[0];
    if (!cn || cn.HasErrors) { cnFailed++; console.log(`  x CN ${d.name}: ${cn?.ValidationErrors?.[0]?.Message}`); continue; }
    await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, xeroCreditNoteId: cn.CreditNoteID, xeroStatus: cn.Status, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } } });
    cnPushed++;
    await sleep(1100);
  }
  console.log(`DONE invoices pushed=${pushed} stamped=${stamped} failed=${failed} · CNs pushed=${cnPushed} failed=${cnFailed}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
