/**
 * WCT Racking Pte Ltd: org bootstrap (owner 2026-11-02). A sister company of
 * WCT: industrial racking and mezzanine specialist, UEN 202100255Z,
 * incorporated 2 Jan 2021 (AIMS has no incorporation-date field; kept here and
 * in the ActionLog row). Built from WCT's own setup MINUS WCT-only features.
 *
 * Copied from WCT: modules (Orders and Service Reports off), feature flags
 * (WCT-only ones off), preset roles + permissions, accounting settings, the
 * default SG chart (WCT's 26 accounts, checked equal to the default), the 13
 * GST codes, number formats (every series prefixed WR-, own counters from 1),
 * document templates (WCT's layout, cloned as WCT Racking's own so edits never
 * cross over), the letterhead profile (address / phone / email / website:
 * WCT's for now, TO CONFIRM). The logo is WCT's for now as the normal org
 * logo setting (Org Settings, Company Profile). NOT copied: customers or any
 * data, WCT's bank / PayNow / payment details and company stamp, custom job
 * fields, SiteClock link.
 *
 * Phase 1 creates the org. Phase 2 (--add-finance, once the org exists) adds
 * finance@wct.com.sg as Admin of WCT Racking via a normal membership, the same
 * rows "Add user" writes for an existing login.
 *
 * ONE transaction per run. Every row written must belong to the new org; that
 * is checked INSIDE the transaction (every written id, and every other org's
 * row counts unchanged, WCT's in detail); any miss aborts the whole run.
 *
 *   DBURL=<prod url, inline> npx ts-node -r tsconfig-paths/register --transpile-only scripts/setup-wct-racking-org.ts            # dry run (READ ONLY)
 *   … --rehearse                    # all writes, every check, then ROLLBACK
 *   … --apply --confirm-prod        # COMMIT
 *   … --add-finance [--rehearse | --apply --confirm-prod]
 *
 * Never touches DocumentNumberFormat / counters of any other org.
 */
import { randomUUID } from 'crypto';
import { Client, types } from 'pg';
import { DEFAULT_CHART_OF_ACCOUNTS, DEFAULT_NEXT_NUMBERS } from '../src/accounting/default-chart-of-accounts';
import { DOC_CODE, DocumentNumberingService, ORDER_DOC_CODE, ORDER_NUMBER_TYPE } from '../src/document-numbering/document-numbering.service';

types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const args = process.argv.slice(2);
const MODE = args.includes('--apply') ? 'apply' : args.includes('--rehearse') ? 'rehearse' : 'dry';
const PHASE = args.includes('--add-finance') ? 'finance' : 'org';
if (MODE === 'apply' && !args.includes('--confirm-prod')) {
  console.error('--apply needs --confirm-prod');
  process.exit(1);
}

export const NEW_ORG_ID = '5c700000-0000-4000-8000-5c7000000002';
const NEW_NAME = 'WCT Racking Pte Ltd';
const UEN = '202100255Z';
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const OSIRIS_ORG_ID = 'd068f159-e45a-4da8-beaf-62e903f44141'; // its superadmins get superadmin, as on WCT
const FINANCE_EMAIL = 'finance@wct.com.sg';
const PREFIX = 'WR-';
const JOB = 'system:setup-wct-racking-org';

// Off on WCT Racking: WCT-only features, and the ones tied to modules that are off.
const FLAGS_OFF = [
  'enableWctOrders',
  'enableWctOrderInvoice',
  'enableWctFinishModes',
  'enableWctMyJobs',
  'enableSiteClockLink',
  'enableJobFields',
  'enableJobsCalendar',
  'enableWhatsAppAgent',
  'enableDeliveryGroupPosts',
  'enableProjects',
  'enableMaintenanceDates',
  'enableServiceItems',
];
const MODULES_OFF = new Set(['ORDERS', 'MAINTENANCE']);
const TO_CONFIRM: string[] = [];

let problems = 0;
const out = (s = '') => console.log(s);
const stop = (why: string) => {
  problems++;
  out(`  !! STOP: ${why}`);
};

async function main() {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('DBURL is not set');
  const host = new URL(url).host;
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(MODE === 'dry' ? 'BEGIN READ ONLY' : 'BEGIN');
  if (MODE !== 'dry') await c.query(`SET LOCAL idle_in_transaction_session_timeout = '15min'`);
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const one = async (sql: string, p: any[] = []) => (await q(sql, p))[0] ?? null;
  const cols = async (t: string) =>
    (await q(`select column_name c from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).map((r: any) => r.c as string);
  const written: Record<string, string[]> = {};
  const note = (t: string, id: string) => (written[t] = [...(written[t] ?? []), id]);
  const ins = async (t: string, row: Record<string, any>) => {
    const keys = Object.keys(row);
    const vals = keys.map((k) => (row[k] !== null && typeof row[k] === 'object' && !(row[k] instanceof Date) && !Array.isArray(row[k]) ? JSON.stringify(row[k]) : row[k]));
    if (MODE !== 'dry') await c.query(`insert into "${t}" (${keys.map((k) => `"${k}"`).join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, vals);
    if (row.id) note(t, row.id);
  };
  // A WCT row copied as a new-org row: every column kept unless overridden; new id, org, timestamps.
  const copyOf = async (t: string, src: any, over: Record<string, any>) => {
    const cs = await cols(t);
    const row: Record<string, any> = {};
    for (const k of cs) if (k in src) row[k] = src[k];
    const now = new Date();
    if (cs.includes('id')) row.id = randomUUID();
    if (cs.includes('organizationId')) row.organizationId = NEW_ORG_ID;
    if (cs.includes('createdAt')) row.createdAt = now;
    if (cs.includes('updatedAt')) row.updatedAt = now;
    return { ...row, ...over };
  };

  out(
    `WCT RACKING SETUP (${PHASE === 'org' ? 'phase 1: create the org' : 'phase 2: add finance@wct.com.sg'}): ${MODE === 'dry' ? 'DRY RUN (read only; nothing is written)' : MODE === 'rehearse' ? 'REHEARSAL (writes, then ROLLBACK)' : 'APPLY'}`,
  );
  out(`db ${host.split('.')[0]} · run at ${new Date().toISOString()}`);
  const wct = await one(`select * from "Organization" where id=$1`, [WCT]);
  if (!wct) throw new Error('WCT not found');

  // Snapshot every table we write: rows per org other than the new one (WCT's in detail).
  const TABLES = [
    'Organization',
    'OrganizationUIConfig',
    'OrganizationModule',
    'Role',
    'AccountingSetting',
    'ChartOfAccount',
    'TaxRate',
    'DocumentNumberFormat',
    'DocumentTemplate',
    'UserOrganization',
    'UserRole',
  ];
  const snapshot = async () => {
    const s: Record<string, string> = {};
    for (const t of TABLES) {
      const orgCol = t === 'Organization' ? 'id' : '"organizationId"';
      const r = await one(
        `select count(*)::int n, count(*) filter (where ${orgCol}=$1)::int wct, coalesce(max(${t === 'UserRole' ? '"createdAt"' : '"updatedAt"'})::text,'') last from "${t}" where ${orgCol} is distinct from $2`,
        [WCT, NEW_ORG_ID],
      );
      s[t] = `${r.n}/${r.wct}/${r.last}`;
    }
    s._PermissionToRole = String((await one(`select count(*)::int n from "_PermissionToRole" where "B" not in (select id from "Role" where "organizationId"=$1)`, [NEW_ORG_ID])).n);
    return s;
  };
  const before = await snapshot();

  if (PHASE === 'org') await phaseOrg();
  else await phaseFinance();

  // ── in-transaction proof: every written row is the new org's; nothing else changed ──
  out('\n== Proof (inside the transaction)');
  let bad = 0;
  for (const [t, ids] of Object.entries(written)) {
    if (t === '_PermissionToRole') continue;
    const orgCol = t === 'Organization' ? 'id' : '"organizationId"';
    const rows = MODE === 'dry' ? ids.map(() => ({ org: NEW_ORG_ID })) : await q(`select ${orgCol}::text org from "${t}" where id = any($1::text[])`, [ids]);
    const other = rows.filter((r: any) => r.org !== NEW_ORG_ID).length;
    const missing = ids.length - rows.length;
    out(`  ${t.padEnd(24)} written ${String(ids.length).padStart(4)}  new org ${String(rows.length - other).padStart(4)}  other org ${other}${missing ? `  MISSING ${missing}` : ''}`);
    if (other || missing) bad++;
  }
  if (written._PermissionToRole) {
    const links =
      MODE === 'dry'
        ? written._PermissionToRole.length
        : Number((await one(`select count(*)::int n from "_PermissionToRole" where "B" in (select id from "Role" where "organizationId"=$1)`, [NEW_ORG_ID])).n);
    out(`  ${'_PermissionToRole'.padEnd(24)} written ${String(written._PermissionToRole.length).padStart(4)}  on new-org roles ${links}`);
    if (links !== written._PermissionToRole.length && PHASE === 'org') bad++;
  }
  const after = await snapshot();
  for (const t of Object.keys(before)) {
    const same = before[t] === after[t];
    if (!same) {
      bad++;
      out(`  !! ${t}: other orgs changed (${before[t]} -> ${after[t]})`);
    }
  }
  out(`  other orgs (WCT included): ${Object.keys(before).every((t) => before[t] === after[t]) ? 'unchanged in every table written' : 'CHANGED'}`);
  if (bad) stop(`${bad} proof check(s) failed`);

  out('\n== TO CONFIRM');
  for (const t of TO_CONFIRM) out(`  - ${t}`);

  if (MODE === 'dry' || problems) {
    await c.query('ROLLBACK');
    out(`\n${problems ? `${problems} PROBLEM(S)${MODE === 'dry' ? '' : ': ROLLBACK, nothing written'}` : 'No problems found.'}${MODE === 'dry' ? ' DRY RUN: nothing was written.' : ''}`);
    await c.end();
    process.exit(problems ? 1 : 0);
  }
  await c.query(
    `insert into "ActionLog" (id,"actorType","actorId","actorName","organizationId",channel,action,resource,details,status,"createdAt") values ($1,'SYSTEM',$2,'System creation',$3,'operator','CREATE',$4,$5::jsonb,'SUCCESS',now())`,
    [
      randomUUID(),
      JOB,
      NEW_ORG_ID,
      PHASE === 'org' ? 'Organization' : 'UserOrganization',
      JSON.stringify({
        name: NEW_NAME,
        uen: UEN,
        incorporated: '2021-01-02',
        about: 'Industrial racking and mezzanine specialist',
        phase: PHASE,
        written: Object.fromEntries(Object.entries(written).map(([t, ids]) => [t, ids.length])),
        toConfirm: TO_CONFIRM,
      }),
    ],
  );
  if (MODE === 'rehearse') {
    await c.query('ROLLBACK');
    out('\nREHEARSAL OK: every check passed. ROLLBACK: nothing kept.');
  } else {
    await c.query('COMMIT');
    out('\nAPPLIED: committed (+1 ActionLog row).');
  }
  await c.end();

  // ── phase 1 ──
  async function phaseOrg() {
    out('\n== 0. Checks');
    const taken = await q(`select id, name from "Organization" where id=$1 or lower(name)=lower($2) or "registrationNumber"=$3`, [NEW_ORG_ID, NEW_NAME, UEN]);
    if (taken.length) stop(`already exists: ${taken.map((t: any) => `${t.name} ${t.id}`).join(', ')}`);
    else out(`  ${NEW_NAME} / ${UEN} / ${NEW_ORG_ID}: free`);

    // 1. Organization
    const docTypeDefaults = JSON.parse(
      JSON.stringify(wct.docTypeDefaults ?? {})
        .replace(/WCT \(S\) Systems Pte Ltd/g, NEW_NAME)
        .replace(/WCT \(S\) SYSTEMS PTE LTD/g, NEW_NAME.toUpperCase()),
    );
    const leftList = [
      ...new Set(
        Object.values(docTypeDefaults as Record<string, any>).flatMap((v: any) =>
          Object.values(v ?? {}).flatMap((t: any) => String(t ?? '').match(/[^.\n]*\bWCT\b(?! Racking| RACKING)[^.\n]*/g) || []),
        ),
      ),
    ].map((x) => x.trim());
    const leftWct = leftList.length;
    const orgRow = {
      id: NEW_ORG_ID,
      name: NEW_NAME,
      createdAt: new Date(),
      updatedAt: new Date(),
      address: wct.address,
      phoneNumber: wct.phoneNumber,
      email: wct.email,
      website: wct.website,
      registrationNumber: UEN,
      logo: wct.logo, // the normal org logo (Org Settings, Company Profile)
      defaultStamp: null,
      customDocumentTypes: wct.customDocumentTypes,
      taxRate: 9,
      taxApplicable: true,
      absorbTax: false,
      defaultCurrency: 'SGD',
      quoteRoundingStep: wct.quoteRoundingStep,
      stockDeductionTrigger: wct.stockDeductionTrigger,
      docTypeDefaults,
      bankDetails: null,
    };
    out('\n== 1. Organization');
    out(`  ${NEW_NAME}  id ${NEW_ORG_ID}  UEN / GST Reg No ${UEN}  SGD  GST 9% (applies, prices exclude GST)`);
    out(`  address  ${orgRow.address}   (WCT's, TO CONFIRM)`);
    out(`  phone ${orgRow.phoneNumber} · email ${orgRow.email} · website ${orgRow.website}   (WCT's, TO CONFIRM)`);
    out(`  logo ${orgRow.logo}   (WCT's for now; changeable in Org Settings, Company Profile)`);
    out(`  T&C / notes per document type: WCT's, with "WCT (S) Systems Pte Ltd" -> "${NEW_NAME}"${leftWct ? ` (${leftWct} other WCT mention(s) left)` : ''}`);
    TO_CONFIRM.push(`Address, phone, email, website are WCT's: ${orgRow.address} · ${orgRow.phoneNumber} · ${orgRow.email} · ${orgRow.website}`);
    TO_CONFIRM.push(`GST registration number = UEN ${UEN} (prints as both Company Reg and GST Reg No on the letterhead)`);
    TO_CONFIRM.push("Terms & conditions are WCT's with the company name swapped; some clauses are WCT's ventilation wording (MV design, VSD inverters) and need WCT Racking's own terms");
    for (const l of leftList) TO_CONFIRM.push(`T&C line still naming WCT: "${l.slice(0, 160)}"`);
    TO_CONFIRM.push("Bank details / PayNow UEN / payment details: not copied (WCT's would send payments to WCT); set them in Org Settings before the first invoice");
    TO_CONFIRM.push("Company stamp: not copied (WCT's stamp); upload WCT Racking's in Org Settings");
    TO_CONFIRM.push("Logo is WCT's for now; replace it in Org Settings, Company Profile");
    await ins('Organization', orgRow);

    // 2. UI config + feature flags
    const ui = await one(`select * from "OrganizationUIConfig" where "organizationId"=$1`, [WCT]);
    const wf = (ui?.features ?? {}) as Record<string, any>;
    const features = { ...wf };
    for (const f of FLAGS_OFF) if (f in features) features[f] = false;
    const on = Object.entries(features)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    out('\n== 2. Feature flags');
    out(`  on (${on.length}): ${on.join(', ')}`);
    out(`  off (WCT-only / modules off): ${FLAGS_OFF.filter((f) => wf[f] === true).join(', ')}`);
    await ins('OrganizationUIConfig', await copyOf('OrganizationUIConfig', ui, { features, currency: 'SGD' }));

    // 3. Modules
    const mods = await q(`select * from "OrganizationModule" where "organizationId"=$1 order by "sortOrder"`, [WCT]);
    out('\n== 3. Modules');
    const onMods: string[] = [];
    for (const m of mods) {
      const enabled = m.enabled && !MODULES_OFF.has(m.moduleCode);
      if (enabled) onMods.push(m.moduleCode);
      await ins('OrganizationModule', await copyOf('OrganizationModule', m, { enabled }));
    }
    out(`  on: ${onMods.join(', ')}`);
    out(
      `  off: ${mods
        .filter((m: any) => !onMods.includes(m.moduleCode))
        .map((m: any) => m.moduleCode)
        .join(', ')}`,
    );

    // 4. Roles + permissions
    const roles = await q(`select r.*, (select array_agg(pr."A") from "_PermissionToRole" pr where pr."B"=r.id) perms from "Role" r where r."organizationId"=$1 order by r.name`, [WCT]);
    out("\n== 4. Roles (WCT's presets, same permissions)");
    const roleIdByName: Record<string, string> = {};
    for (const r of roles) {
      const allowed = Array.isArray(r.allowedModules) ? r.allowedModules.filter((x: string) => !MODULES_OFF.has(x)) : r.allowedModules;
      const row = await copyOf('Role', r, { allowedModules: allowed });
      delete (row as any).perms;
      roleIdByName[r.name] = row.id;
      await ins('Role', row);
      for (const p of r.perms ?? []) {
        if (MODE !== 'dry') await c.query(`insert into "_PermissionToRole" ("A","B") values ($1,$2)`, [p, row.id]);
        note('_PermissionToRole', `${p}:${row.id}`);
      }
      out(`  ${r.name.padEnd(12)} ${String((r.perms ?? []).length).padStart(3)} permissions${Array.isArray(allowed) && allowed.length ? `  modules ${allowed.join(',')}` : ''}`);
    }

    // 5. Accounting settings
    const acct = await one(`select * from "AccountingSetting" where "organizationId"=$1`, [WCT]);
    out('\n== 5. Accounting');
    await ins(
      'AccountingSetting',
      await copyOf('AccountingSetting', acct, {
        baseCurrency: 'SGD',
        taxDefaultPercentage: 9,
        taxRegistrationNumber: UEN,
        taxReference: 'GST',
        salesTaxInclusive: false,
        fiscalYearEndDay: 31,
        fiscalYearEndMonth: 12,
        timeZone: 'Asia/Singapore',
        nextNumbers: DEFAULT_NEXT_NUMBERS,
        numberPrefixes: {},
        closeHistory: null,
        lockedThroughDate: null,
        yearOpeningDate: null,
        yearOpeningStock: null,
        monthOpeningDate: null,
        monthOpeningStock: null,
        monthClosingStock: null,
        paymentDetails: null,
      }),
    );
    out(`  SGD · GST 9% (GST reg no ${UEN}) · prices exclude GST · FY ends 31 Dec · Asia/Singapore · control accounts as WCT (by code)`);

    // 6. Chart of accounts: WCT's 26 = the default SG chart (checked)
    const coa = await q(`select * from "ChartOfAccount" where "organizationId"=$1 order by code`, [WCT]);
    const want = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a: any) => [a.code, a.name]));
    const same = coa.length === want.size && coa.every((a: any) => want.get(a.code) === a.name) && coa.every((a: any) => !a.parentAccountId);
    if (!same) stop(`WCT's chart is not exactly the default SG chart (${coa.length} vs ${want.size})`);
    for (const a of coa) await ins('ChartOfAccount', await copyOf('ChartOfAccount', a, { xeroId: null, xeroLastSyncAt: null }));
    out(`  chart of accounts: ${coa.length} accounts (the default SG chart${same ? ', checked' : ''})`);

    // 7. GST codes
    const tax = await q(`select * from "TaxRate" where "organizationId"=$1 order by code`, [WCT]);
    for (const t of tax) await ins('TaxRate', await copyOf('TaxRate', t, {}));
    out(
      `  GST codes: ${tax.length} (${tax.filter((t: any) => t.isActive).length} active: ${tax
        .filter((t: any) => t.isActive && Number(t.rate) === 9)
        .map((t: any) => t.name)
        .join(', ')} at 9%; 7% / 8% codes inactive)`,
    );

    // 8. Number formats: WR- on every series, own counters from 1
    const fmts = await q(`select * from "DocumentNumberFormat" where "organizationId"=$1 and "isActive" order by "documentType"`, [WCT]);
    out('\n== 6. Number formats (WR- prefix, own counters from 1)');
    const today = new Date();
    for (const f of fmts) {
      const pattern = `${PREFIX}${f.pattern}`;
      await ins('DocumentNumberFormat', await copyOf('DocumentNumberFormat', f, { pattern, nextSerial: 1, lastResetKey: null }));
      const code = f.documentType === ORDER_NUMBER_TYPE ? ORDER_DOC_CODE : (DOC_CODE[f.documentType] ?? '');
      out(`  ${f.documentType.padEnd(17)} ${pattern.padEnd(30)} next: ${DocumentNumberingService.format(pattern, 1, today, code)}`);
    }
    out(`  Journals (GL): JV-000001 (journal numbers take no prefix in AIMS; they are per organisation)`);

    // 9. Document templates: WCT's, cloned as WCT Racking's own (isDefault false: no other org's fallback moves)
    const tpls = await q(`select * from "DocumentTemplate" where "organizationId"=$1 and "isActive" order by type`, [WCT]);
    out("\n== 7. Document templates (WCT's layout, cloned as WCT Racking's own)");
    for (const t of tpls) {
      const name = String(t.name ?? '').replace(/^WCT\b/, 'WCT Racking');
      await ins('DocumentTemplate', await copyOf('DocumentTemplate', t, { name, isDefault: false, isActive: true }));
      out(`  ${t.type.padEnd(28)} ${name}${t.styleConfig?.layout ? `  (layout ${t.styleConfig.layout})` : ''}`);
    }

    // 10. Access: Osiris superadmins → superadmin (as on WCT)
    const admins = await q(`select distinct ur."userId" from "UserRole" ur join "Role" r on r.id=ur."roleId" where ur."organizationId"=$1 and ur."isActive" and r.name='superadmin'`, [OSIRIS_ORG_ID]);
    out(`\n== 8. Access\n  Osiris superadmins -> superadmin on ${NEW_NAME}: ${admins.length}`);
    for (const a of admins) {
      await ins('UserOrganization', { id: randomUUID(), userId: a.userId, organizationId: NEW_ORG_ID, isActive: true, createdAt: new Date(), updatedAt: new Date(), joinedAt: new Date() });
      await ins('UserRole', { id: randomUUID(), userId: a.userId, roleId: roleIdByName['superadmin'], organizationId: NEW_ORG_ID, isActive: true, createdAt: new Date(), assignedAt: new Date() });
    }
    out(`  finance@wct.com.sg: added in phase 2 (--add-finance) once the org exists`);
    out('  Not copied: customers / suppliers / stock / documents, custom job fields, SiteClock connection, WhatsApp settings');
  }

  // ── phase 2 ──
  async function phaseFinance() {
    out('\n== Add finance@wct.com.sg as Admin of WCT Racking');
    const org = await one(`select id, name from "Organization" where id=$1`, [NEW_ORG_ID]);
    if (!org) return stop(`${NEW_NAME} does not exist yet (run phase 1 first)`);
    const ids = await q(`select distinct "actorId" id from "ActionLog" where lower("actorEmail")=$1 and "actorType"='USER'`, [FINANCE_EMAIL]);
    if (ids.length !== 1) return stop(`expected one AIMS user for ${FINANCE_EMAIL}, found ${ids.length}`);
    const userId = ids[0].id as string;
    const mem = await q(`select o.name, uo."isActive" from "UserOrganization" uo join "Organization" o on o.id=uo."organizationId" where uo."userId"=$1`, [userId]);
    const wctRoles = await q(`select r.name from "UserRole" ur join "Role" r on r.id=ur."roleId" where ur."userId"=$1 and ur."organizationId"=$2 and ur."isActive"`, [userId, WCT]);
    out(`  user ${userId.slice(0, 14)}…  now in: ${mem.map((m: any) => `${m.name}${m.isActive ? '' : ' (inactive)'}`).join(', ')}  WCT roles: ${wctRoles.map((r: any) => r.name).join(', ')}`);
    if (!mem.some((m: any) => m.name === 'WCT' && m.isActive) || !wctRoles.some((r: any) => r.name === 'Admin')) stop('she is not an active WCT Admin');
    const admin = await one(`select id from "Role" where "organizationId"=$1 and name='Admin'`, [NEW_ORG_ID]);
    if (!admin) return stop('WCT Racking has no Admin role');
    if (await one(`select 1 from "UserOrganization" where "userId"=$1 and "organizationId"=$2`, [userId, NEW_ORG_ID])) return stop('she is already a member of WCT Racking');
    await ins('UserOrganization', { id: randomUUID(), userId, organizationId: NEW_ORG_ID, isActive: true, createdAt: new Date(), updatedAt: new Date(), joinedAt: new Date() });
    await ins('UserRole', { id: randomUUID(), userId, roleId: admin.id, organizationId: NEW_ORG_ID, isActive: true, createdAt: new Date(), assignedAt: new Date() });
    out(`  -> UserOrganization + Admin role in ${NEW_NAME} (WCT membership and roles untouched)`);
  }
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
