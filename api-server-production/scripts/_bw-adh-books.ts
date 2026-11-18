/**
 * Round BW — ADH books, setup (ADH only; DRY RUN unless --apply):
 *   1. OrganizationUIConfig.features.enableDocumentGlPosting = false   (documents never post a GL journal)
 *   2. Provisional chart: 620 Prepayments, 810 Advance, 200 Sales, 310 COGS + the system accounts the lot postings
 *      need (610 AR, 800 AP, 090 Bank USD, 499 FX, 820 GST, 960 Retained Earnings — Xero standard codes) — created only when the code is missing
 *   3. AccountingSetting: base currency SGD, control accounts → those codes (created when missing; an existing row gets its control keys repointed)
 * Step 1 runs first; 2–3 are skipped while the flag isn't false (re-run after). Every other org's features, charts
 * and settings are hashed before and after and must be identical. Writes are logged (ActionLog + _bw-adh-books.log.json).
 *
 *   dev : npx ts-node --transpile-only scripts/_bw-adh-books.ts --target=tenancy [--apply]   (also creates FxRate / LotPosting in org_adhjapan)
 *   prod: DATABASE_URL=<prod> npx ts-node --transpile-only scripts/_bw-adh-books.ts --target=public [--apply --confirm-prod]
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { PrismaNeon } from '@prisma/adapter-neon';

const argv = process.argv.slice(2);
const TARGET = argv.find((a) => a.startsWith('--target='))?.split('=')[1];
const APPLY = argv.includes('--apply');
const PROD_ID = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const ADH_NAME = 'Asia Deal Hub Japan LLC';
const LOG = path.join(__dirname, '_bw-adh-books.log.json');
const FLAG = 'enableDocumentGlPosting';

export const ADH_CHART = [
  { code: '620', name: 'Prepayments', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', note: 'PI deposit + CI bills until delivery (FRS)' },
  { code: '810', name: 'Advance', accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', note: 'Advance invoices / GST / settlement with ADH Japan (FRS)' },
  { code: '200', name: 'Sales', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT', note: 'Product sales + 85% management fee (FRS)' },
  { code: '310', name: 'Cost of Goods Sold', accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT', note: 'Reclassified from 620 on the 1st of the delivery month (FRS)' },
  { code: '610', name: 'Accounts Receivable', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', control: true, note: 'system account (Xero standard code)' },
  { code: '800', name: 'Accounts Payable', accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', control: true, note: 'system account (Xero standard code)' },
  { code: '090', name: 'Bank (USD)', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', note: 'system account — one USD bank until ADH\'s real bank accounts come from Xero' },
  { code: '499', name: 'Realised Currency Gains', accountType: 'EXCHANGE_GAIN_LOSS', category: 'PNL', normalBalance: 'CREDIT', note: 'system account (Xero standard code)' },
  { code: '820', name: 'GST', accountType: 'TAX_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', control: true, note: 'system account (Xero standard code)' },
  { code: '960', name: 'Retained Earnings', accountType: 'RETAINED_PROFIT', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', note: 'system account (Xero standard code)' },
];
const CONTROLS = { debtorControl: '610', creditorControl: '800', fxGainLoss: '499', taxLiabilities: '820', retainedProfits: '960', bankAccount: '090', foreignBankAccount: '090', salesAccount: '200' };

function neonAdapter(schema: string) {
  const url = new URL(process.env.DATABASE_URL as string);
  for (const k of ['pool_timeout', 'connect_timeout', 'schema']) url.searchParams.delete(k);
  return new PrismaNeon({ connectionString: url.toString() }, { schema });
}
const load = (name: string) => require(path.join(process.cwd(), 'node_modules/.prisma-tenancy', name));
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

async function main() {
  if (TARGET !== 'public' && TARGET !== 'tenancy') throw new Error('--target=public|tenancy is required');
  const isProd = /ep-[a-z-]*/.test(process.env.DATABASE_URL ?? '') && TARGET === 'public';
  if (APPLY && isProd && !argv.includes('--confirm-prod')) throw new Error('--apply on the shared schema needs --confirm-prod');
  let plat: any;
  let org: any;
  if (TARGET === 'public') {
    const { PrismaClient } = require('@prisma/client');
    plat = org = new PrismaClient({ adapter: neonAdapter('public') });
  } else {
    plat = new (load('platform').PrismaClient)({ adapter: neonAdapter('platform') });
    org = new (load('org-adhjapan').PrismaClient)({ adapter: neonAdapter('org_adhjapan') });
  }
  const adh = (await plat.organization.findUnique({ where: { id: PROD_ID }, select: { id: true, name: true } })) ?? (await plat.organization.findFirst({ where: { name: ADH_NAME }, select: { id: true, name: true } }));
  if (!adh) throw new Error('ADH org not found');
  const ORG = adh.id;
  const writes: string[] = [];
  const log: any[] = [];
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · ${TARGET} · ${adh.name} (${ORG})`);

  // Other orgs' state — must not change.
  const others = async () => {
    const ui = await plat.organizationUIConfig.findMany({ where: { organizationId: { not: ORG } }, orderBy: { organizationId: 'asc' }, select: { organizationId: true, features: true } });
    const coa = TARGET === 'public' ? await org.chartOfAccount.findMany({ where: { organizationId: { not: ORG } }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true, isActive: true } }) : [];
    const st = TARGET === 'public' ? await org.accountingSetting.findMany({ where: { organizationId: { not: ORG } }, orderBy: { organizationId: 'asc' }, select: { organizationId: true, baseCurrency: true, controlAccounts: true, currencyRates: true } }) : [];
    return { features: hash(ui), coa: hash(coa), settings: hash(st), n: `${ui.length} configs · ${coa.length} accounts · ${st.length} settings` };
  };
  const before = await others();
  console.log(`other orgs: ${before.n} · hashes ${before.features}/${before.coa}/${before.settings}`);

  // Dev only: the two new tables in org_adhjapan (prod gets them from Render's prisma db push).
  if (TARGET === 'tenancy') {
    const have = await org.$queryRawUnsafe(`select table_name::text as table_name from information_schema.tables where table_schema='org_adhjapan' and table_name in ('FxRate','LotPosting')`);
    const names = (have as any[]).map((r) => r.table_name);
    for (const t of ['FxRate', 'LotPosting'].filter((t) => !names.includes(t))) writes.push(`dev table org_adhjapan."${t}"`);
    const col = await org.$queryRawUnsafe(`select 1 from information_schema.columns where table_schema='org_adhjapan' and table_name='TradeOrder' and column_name='booksInput'`);
    if (!(col as any[]).length) writes.push('dev column org_adhjapan."TradeOrder"."booksInput"');
    if (APPLY) {
      await org.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "org_adhjapan"."FxRate" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" text NOT NULL, "month" text NOT NULL, "currency" text NOT NULL, "baseCurrency" text NOT NULL DEFAULT 'SGD', "rate" numeric(18,8) NOT NULL, "note" text, "enteredById" text, "enteredByName" text, "enteredAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL)`);
      await org.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "FxRate_organizationId_month_currency_key" ON "org_adhjapan"."FxRate"("organizationId","month","currency")`);
      await org.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FxRate_organizationId_month_idx" ON "org_adhjapan"."FxRate"("organizationId","month")`);
      await org.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "org_adhjapan"."LotPosting" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" text NOT NULL, "orderId" uuid NOT NULL, "shipmentId" uuid, "postingKey" text NOT NULL, "frsRef" text, "contactName" text, "contactType" text, "contactId" uuid, "currency" text NOT NULL DEFAULT 'USD', "amount" numeric(16,2), "rateMonth" text, "rate" numeric(18,8), "status" text NOT NULL DEFAULT 'POSTED', "journalEntryId" uuid, "lines" jsonb, "createdById" text, "createdByName" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL)`);
      await org.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "LotPosting_organizationId_orderId_postingKey_key" ON "org_adhjapan"."LotPosting"("organizationId","orderId","postingKey")`);
      await org.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LotPosting_organizationId_orderId_idx" ON "org_adhjapan"."LotPosting"("organizationId","orderId")`);
      await org.$executeRawUnsafe(`ALTER TABLE "org_adhjapan"."TradeOrder" ADD COLUMN IF NOT EXISTS "booksInput" jsonb`);
    }
  }

  // 1. The switch.
  const ui = await plat.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
  if (!ui) throw new Error('ADH has no OrganizationUIConfig row');
  const cur = ((ui.features as Record<string, unknown>) || {})[FLAG];
  let flagOff = cur === false;
  console.log(`1. ${FLAG}: ${JSON.stringify(cur ?? null)} → false`);
  if (!flagOff) {
    writes.push(`features.${FLAG} = false`);
    if (APPLY) {
      await plat.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: { ...((ui.features as object) || {}), [FLAG]: false } } });
      log.push({ step: 1, write: `features.${FLAG}`, from: cur ?? null, to: false });
      flagOff = true;
    }
  }

  // 2. Chart (only after the switch is off — no settings or accounts exist while documents could still post).
  const existing = await org.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { code: true, name: true } });
  const codes = new Set(existing.map((a: any) => a.code));
  console.log(`2. chart: ADH has ${existing.length} accounts`);
  for (const a of ADH_CHART) {
    if (codes.has(a.code)) {
      console.log(`   ${a.code} exists — kept`);
      continue;
    }
    writes.push(`account ${a.code} ${a.name}`);
    console.log(`   + ${a.code} ${a.name} (${a.accountType}) — Provisional`);
    if (APPLY && flagOff) {
      await org.chartOfAccount.create({
        data: { organizationId: ORG, code: a.code, name: a.name, description: `Provisional — ${a.note}`, accountType: a.accountType, category: a.category, normalBalance: a.normalBalance, isControlAccount: !!(a as any).control, isSystem: false, isActive: true },
      });
      log.push({ step: 2, write: `ChartOfAccount ${a.code}` });
    }
  }

  // 3. Settings: base SGD, controls → the codes above. Create when ADH has none; otherwise point the existing row's
  //    control keys at these codes (other keys and fields untouched).
  const st = await org.accountingSetting.findUnique({ where: { organizationId: ORG }, select: { id: true, baseCurrency: true, controlAccounts: true } });
  console.log(`3. AccountingSetting: ${st ? `exists (base ${st.baseCurrency})` : 'none → create (base SGD, controls ' + JSON.stringify(CONTROLS) + ')'}`);
  if (st) {
    if (st.baseCurrency !== 'SGD') throw new Error(`ADH base currency is ${st.baseCurrency}, expected SGD — stop`);
    const old = ((st.controlAccounts as Record<string, string>) || {}) as Record<string, string>;
    const diff = Object.entries(CONTROLS).filter(([k, v]) => old[k] !== v);
    for (const [k, v] of diff) console.log(`   ${k}: ${old[k] ?? '(none)'} → ${v}`);
    const kept = Object.keys(old).filter((k) => !(k in CONTROLS));
    if (kept.length) console.log(`   kept as-is: ${kept.map((k) => `${k}=${old[k]}`).join(', ')}`);
    if (diff.length) {
      writes.push(`AccountingSetting.controlAccounts (${diff.length} keys)`);
      if (APPLY && flagOff) {
        const next = { ...old, ...CONTROLS };
        await org.accountingSetting.update({ where: { id: st.id }, data: { controlAccounts: next } });
        log.push({ step: 3, write: 'AccountingSetting.controlAccounts', from: Object.fromEntries(diff.map(([k]) => [k, old[k] ?? null])), to: Object.fromEntries(diff) });
      }
    }
  } else {
    writes.push('AccountingSetting (base SGD)');
    if (APPLY && flagOff) {
      await org.accountingSetting.create({ data: { organizationId: ORG, baseCurrency: 'SGD', controlAccounts: CONTROLS } });
      log.push({ step: 3, write: 'AccountingSetting', baseCurrency: 'SGD', controlAccounts: CONTROLS });
    }
  }

  console.log(`writes planned: ${writes.length}${writes.length ? ` — ${writes.join(' · ')}` : ''}`);
  if (!APPLY) return;
  const after = await others();
  const same = after.features === before.features && after.coa === before.coa && after.settings === before.settings;
  console.log(`other orgs after: ${after.n} · hashes ${after.features}/${after.coa}/${after.settings} · ${same ? 'UNCHANGED' : '⚠ CHANGED'}`);
  if (log.length) {
    try {
      await plat.actionLog.create({
        data: { actorType: 'SYSTEM', actorId: 'system:round-bw', actorName: 'System creation', organizationId: ORG, channel: 'cron', action: 'UPDATE', resource: 'adh-books-setup', resourceId: ORG, details: { script: '_bw-adh-books.ts', target: TARGET, writes: log } },
      });
    } catch (e: any) {
      console.log(`   (ActionLog row not written: ${String(e?.message ?? e).split('\n').pop()})`);
    }
    const prev = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
    fs.writeFileSync(LOG, JSON.stringify([...prev, { at: new Date().toISOString(), target: TARGET, org: ORG, writes: log, othersUnchanged: same }], null, 2));
  }
}

if (require.main === module)
  main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message ?? e);
    process.exit(1);
  });
