/**
 * Clone ALL Biofuel data dev → staging (guru, 2026-07-13).
 *
 * Wipes Biofuel's rows in STAGING (authorized: "u can clear staging"), then
 * copies every Biofuel-scoped row from DEV in FK-dependency order: org config,
 * flags, roles, CoA, templates (incl. cross-org templates Biofuel documents
 * reference, plus their owner org rows), contacts, assets/inventory/projects,
 * documents + children, payments, the full GL, Xero linkage, audit history.
 *
 * Self-references are copied in two passes (ChartOfAccount.parentAccountId,
 * Asset.parentAssetId, Inventory.parentInventoryId, Document.baseDocumentId)
 * and the ProjectDeployment.sourceDocumentId ↔ Document.projectDeploymentId
 * cycle is broken by nulling sourceDocumentId first and patching after.
 *
 * Run: npx ts-node --transpile-only scripts/clone-biofuel-dev-to-staging.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const BATCH = 500;
const RESUME = process.argv.includes('--resume'); // skip wipe; skipDuplicates carries the rest

// Neon WS pool emits async connection errors that would kill the process even
// though the failed op is retried — swallow only that class.
const TRANSIENT_RE = /closed the connection|connection pool|Connection terminated|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket hang up|fetch failed/i;
process.on('uncaughtException', (e: any) => {
  if (TRANSIENT_RE.test(e?.message || '')) { console.warn(`  ⚠ swallowed transient: ${(e?.message || '').slice(0, 100)}`); return; }
  throw e;
});
async function retry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [2000, 5000, 15000, 60000, 120000];
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e: any) {
      if (!TRANSIENT_RE.test(e?.message || '') || i >= delays.length) throw e;
      console.warn(`  ↻ ${label}: transient, retry in ${delays[i] / 1000}s`);
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
function clientFor(envFile: string): PrismaClient {
  const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!m) throw new Error(`No DATABASE_URL in ${envFile}`);
  const url = new URL(m[1]);
  url.searchParams.delete('pool_timeout');
  url.searchParams.delete('connect_timeout');
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
}
const dev = clientFor('.env');
const stg = clientFor('.env.staging');

const R = (label: string) => (e: any) => { console.error(`  ✗ ${label}: ${(e?.message || e).toString().slice(0, 200)}`); throw e; };

type Spec = {
  m: string; // prisma model accessor
  where?: any; // defaults to { organizationId: ORG }
  selfRef?: string; // self-FK column → two-pass
  nullFirst?: string[]; // columns nulled on insert, patched later
  skipWipe?: boolean;
};

const SPECS: Spec[] = [
  { m: 'role' }, { m: 'userOrganization' }, { m: 'userRole' },
  { m: 'organizationModule' }, { m: 'organizationUIConfig' }, { m: 'accountingSetting' },
  { m: 'taxRate' }, { m: 'documentNumberFormat' }, { m: 'emailIngestConfig' },
  { m: 'category' }, { m: 'customField' },
  { m: 'chartOfAccount', selfRef: 'parentAccountId' }, { m: 'costCenter' },
  { m: 'documentTemplate' }, { m: 'organizationActiveTemplate' },
  { m: 'customer' },
  { m: 'customerContact', where: { customer: { organizationId: ORG } } },
  { m: 'siteOffice', where: { customer: { organizationId: ORG } } },
  { m: 'contactDetail', where: { siteOffice: { customer: { organizationId: ORG } } } },
  { m: 'supplier' },
  { m: 'project' },
  { m: 'asset', selfRef: 'parentAssetId' },
  { m: 'assetTemplateTag', where: { asset: { organizationId: ORG } } },
  { m: 'inventory', selfRef: 'parentInventoryId' },
  { m: 'projectDeployment', nullFirst: ['sourceDocumentId'] },
  { m: 'document', selfRef: 'baseDocumentId' },
  { m: 'documentItem', where: { document: { organizationId: ORG } } },
  { m: 'documentEmbedding' },
  { m: 'timelineItem', where: { OR: [{ document: { organizationId: ORG } }, { inventory: { organizationId: ORG } }] } },
  { m: 'deliveryShareLink', where: { document: { organizationId: ORG } } },
  { m: 'assignment', where: { project: { organizationId: ORG } } },
  { m: 'order' }, { m: 'maintenanceServiceReport' },
  { m: 'deliveryLocationPing', where: { report: { organizationId: ORG } } },
  { m: 'priceHistory' },
  { m: 'payment' }, { m: 'billPayment' }, { m: 'bill' },
  { m: 'transaction' }, { m: 'customerBalance' },
  { m: 'journalEntry' },
  { m: 'journalEntryLine', where: { journalEntry: { organizationId: ORG } } },
  { m: 'fixedAsset' }, { m: 'depreciationEntry' }, { m: 'budget' },
  { m: 'recurringJournalTemplate' }, { m: 'recurringInvoiceTemplate' }, { m: 'revenueItem' },
  { m: 'accountMemory' }, { m: 'quantityAdjustment' }, { m: 'passTrackerEntry' }, { m: 'importInvoice' },
  { m: 'bankStatementImport' }, { m: 'bankStatementLine' },
  { m: 'emailIngestLog' }, { m: 'auditLog' },
  { m: 'customFieldValue', where: { customField: { organizationId: ORG } } },
  { m: 'xeroConnection' }, { m: 'xeroAccountMapping' }, { m: 'xeroSyncRun' },
];

// Ref patches (self-FKs and cycle-breaking columns) are applied AFTER all
// tables are copied — a patch may point at a row of a later table (e.g.
// deployment.sourceDocumentId → Document).
const postPatches: Array<{ m: string; id: string; patch: any }> = [];

async function copySpec(spec: Spec): Promise<number> {
  const where = spec.where ?? { organizationId: ORG };
  const model = (dev as any)[spec.m];
  const target = (stg as any)[spec.m];
  if (!model || !target) { console.log(`  – ${spec.m}: model missing, skipped`); return 0; }
  let copied = 0;
  let skip = 0;
  for (;;) {
    const rows: any[] = await retry(() => model.findMany({ where, take: BATCH, skip, orderBy: { id: 'asc' } }), `${spec.m} read`).catch(R(`${spec.m} read`));
    if (!rows.length) break;
    skip += rows.length;
    const data = rows.map((r) => {
      const row = { ...r };
      if (spec.selfRef && row[spec.selfRef]) {
        postPatches.push({ m: spec.m, id: row.id, patch: { [spec.selfRef]: row[spec.selfRef] } });
        row[spec.selfRef] = null;
      }
      for (const col of spec.nullFirst || []) {
        if (row[col]) { postPatches.push({ m: spec.m, id: row.id, patch: { [col]: row[col] } }); row[col] = null; }
      }
      return row;
    });
    try {
      await retry(() => target.createMany({ data, skipDuplicates: true }), `${spec.m} write`);
      copied += data.length;
    } catch (e: any) {
      // FK trouble in the batch — insert row-by-row, skip offenders.
      let ok = 0, bad = 0;
      for (const row of data) {
        try { await retry(() => target.createMany({ data: [row], skipDuplicates: true }), `${spec.m} row`); ok++; }
        catch { bad++; }
      }
      copied += ok;
      console.log(`  ⚠ ${spec.m}: batch fell back to singles (${ok} ok, ${bad} skipped: ${(e?.message || '').slice(-120)})`);
    }
    process.stdout.write(`\r  ${spec.m}: ${copied}   `);
  }
  if (copied) console.log(`\r  ✓ ${spec.m}: ${copied} rows`);
  return copied;
}

async function main() {
  console.log(`Cloning Biofuel dev → staging  (org ${ORG})\n`);

  // 0) Ensure the Organization row itself matches dev.
  const org = await dev.organization.findUnique({ where: { id: ORG } });
  if (!org) throw new Error('Biofuel org not found in dev');
  const { id: _oid, ...orgData } = org as any;
  await stg.organization.upsert({ where: { id: ORG }, update: orgData, create: { id: ORG, ...orgData } });
  console.log('✓ organization row upserted');

  // 1) WIPE staging Biofuel rows, children first (reverse spec order).
  if (RESUME) console.log('\n--resume: skipping wipe (skipDuplicates carries already-copied rows)');
  for (const spec of RESUME ? [] : [...SPECS].reverse()) {
    const target = (stg as any)[spec.m];
    if (!target) continue;
    const where = spec.where ?? { organizationId: ORG };
    try {
      const res = await target.deleteMany({ where });
      if (res.count) console.log(`  wiped ${spec.m}: ${res.count}`);
    } catch (e: any) {
      console.log(`  ⚠ wipe ${spec.m} failed: ${(e?.message || '').slice(-140)}`);
    }
  }

  // 2) Cross-org templates Biofuel references (shared template library) —
  //    copy them plus bare owner-org rows so FKs hold.
  console.log('\nCopying cross-org referenced templates...');
  const docTmplIds = await dev.document.findMany({ where: { organizationId: ORG }, select: { documentTemplateId: true }, distinct: ['documentTemplateId'] });
  const activeTmpl = await dev.organizationActiveTemplate.findMany({ where: { organizationId: ORG }, select: { templateId: true } });
  const wantedIds = [...new Set([...docTmplIds.map((d) => d.documentTemplateId), ...activeTmpl.map((a) => a.templateId)].filter(Boolean))] as string[];
  const templates = await dev.documentTemplate.findMany({ where: { id: { in: wantedIds } } });
  const foreignOwnerIds = [...new Set(templates.map((t: any) => t.organizationId).filter((o: string) => o && o !== ORG))];
  for (const ownerId of foreignOwnerIds) {
    const owner = await dev.organization.findUnique({ where: { id: ownerId } });
    if (owner) {
      const { id: oid, ...odata } = owner as any;
      await stg.organization.upsert({ where: { id: ownerId }, update: {}, create: { id: ownerId, ...odata } }).catch(() => null);
    }
  }
  if (templates.length) await stg.documentTemplate.createMany({ data: templates as any[], skipDuplicates: true });
  console.log(`  ✓ ${templates.length} referenced templates (${foreignOwnerIds.length} foreign owner orgs ensured)`);

  // 3) Copy everything in dependency order.
  console.log('\nCopying Biofuel data...');
  let total = 0;
  for (const spec of SPECS) total += await copySpec(spec);

  // 3b) Apply deferred ref patches now that every table exists.
  if (postPatches.length) {
    console.log(`\nApplying ${postPatches.length} deferred ref patches...`);
    let patched = 0, failed = 0;
    for (const p of postPatches) {
      try { await retry(() => (stg as any)[p.m].update({ where: { id: p.id }, data: p.patch }), `${p.m} patch`); patched++; }
      catch { failed++; }
    }
    console.log(`  ✓ ${patched} patched${failed ? `, ⚠ ${failed} failed` : ''}`);
  }

  // 4) Verify headline counts.
  console.log('\nVerification:');
  for (const [label, fn] of [
    ['documents', (p: PrismaClient) => p.document.count({ where: { organizationId: ORG } })],
    ['journalEntries', (p: PrismaClient) => p.journalEntry.count({ where: { organizationId: ORG } })],
    ['journalLines', (p: PrismaClient) => p.journalEntryLine.count({ where: { journalEntry: { organizationId: ORG } } })],
    ['customers', (p: PrismaClient) => p.customer.count({ where: { organizationId: ORG } })],
    ['suppliers', (p: PrismaClient) => p.supplier.count({ where: { organizationId: ORG } })],
    ['chartOfAccounts', (p: PrismaClient) => p.chartOfAccount.count({ where: { organizationId: ORG } })],
    ['assets', (p: PrismaClient) => p.asset.count({ where: { organizationId: ORG } })],
    ['inventory', (p: PrismaClient) => p.inventory.count({ where: { organizationId: ORG } })],
  ] as const) {
    const [d, s] = await Promise.all([(fn as any)(dev), (fn as any)(stg)]);
    console.log(`  ${label}: dev=${d} staging=${s} ${d === s ? '✓' : '✗ MISMATCH'}`);
  }
  console.log(`\nDone — ${total} rows copied.`);
}

main()
  .catch((e) => { console.error('FATAL', e?.message || e); process.exit(1); })
  .finally(async () => { await dev.$disconnect(); await stg.$disconnect(); });
