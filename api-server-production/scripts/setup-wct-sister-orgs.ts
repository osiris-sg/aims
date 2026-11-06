/**
 * YMM Kitchen Pte. Ltd. and BC Air Pte. Ltd.: org bootstrap for two more WCT sister companies
 * (owner 2026-11-06). Same path as scripts/setup-wct-racking-org.ts, but ACCOUNTING (+ USER MANAGEMENT) only, on
 * the normal new-org defaults:
 *
 *   - Organization: name, UEN; address and phone are WCT's as placeholders (TO CONFIRM).
 *   - Feature flags: the canonical new-org set (DEFAULT_ORG_FEATURES, what OrganizationsService
 *     .create seeds) with enableWctOrders and the flags of modules that are off set false.
 *   - Modules: WCT's module rows (catalog + menu config), only ACCOUNTING and USER_MANAGEMENT enabled.
 *   - Roles: superadmin (every permission, as create() makes it) + WCT's Admin, and Accounting /
 *     Viewer narrowed to the ACCOUNTING module. Roles with no accounting module left are not made.
 *   - Accounting: AIMS defaults (SGD, GST 9%, FY 31 Dec, DEFAULT_CONTROL_ACCOUNTS / code ranges /
 *     next numbers), the default SG chart (DEFAULT_CHART_OF_ACCOUNTS, the one WCT Racking has),
 *     WCT's GST codes (as WCT Racking got). GST registration no: WCT's (TO CONFIRM).
 *   - Document templates: the default set create() seeds. No DocumentNumberFormat rows: numbering
 *     is the normal default (no custom formats, no counters touched anywhere).
 *   - Access: Osiris superadmins → superadmin (as on WCT / WCT Racking); finance@wct.com.sg → Admin
 *     through a normal membership (UserOrganization + UserRole; no Clerk user, no email).
 *
 * ONE transaction for both orgs. Every row written must belong to a new org, checked INSIDE the
 * transaction, and every other org's rows in the tables written must be unchanged; any miss aborts.
 *
 *   DBURL=<prod url, inline> npx ts-node -r tsconfig-paths/register --transpile-only scripts/setup-wct-sister-orgs.ts   # dry run (READ ONLY)
 *   … --rehearse                 # all writes, every check, then ROLLBACK
 *   … --apply --confirm-prod     # COMMIT
 */
import { randomUUID } from 'crypto';
import { Client, types } from 'pg';
import { DEFAULT_ACCOUNT_CODE_RANGES, DEFAULT_CHART_OF_ACCOUNTS, DEFAULT_CONTROL_ACCOUNTS, DEFAULT_NEXT_NUMBERS } from '../src/accounting/default-chart-of-accounts';
import { DEFAULT_ORG_FEATURES } from '../src/organizations/default-features';
import { DEFAULT_DOCUMENT_TEMPLATES } from '../src/organizations/default-templates';

types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const args = process.argv.slice(2);
const MODE = args.includes('--apply') ? 'apply' : args.includes('--rehearse') ? 'rehearse' : 'dry';
if (MODE === 'apply' && !args.includes('--confirm-prod')) {
  console.error('--apply needs --confirm-prod');
  process.exit(1);
}

export const NEW_ORGS = [
  { id: '5c700000-0000-4000-8000-5c7000000003', name: 'YMM KITCHEN PTE. LTD.', uen: '202025866E' },
  { id: '5c700000-0000-4000-8000-5c7000000004', name: 'BC AIR PTE. LTD.', uen: '202205130K' },
];
const NEW_IDS = NEW_ORGS.map((o) => o.id);
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const WCT_RACKING = '5c700000-0000-4000-8000-5c7000000002';
const OSIRIS_ORG_ID = 'd068f159-e45a-4da8-beaf-62e903f44141';
const FINANCE_EMAIL = 'finance@wct.com.sg';
const UENS = { [WCT]: '201724603K', [WCT_RACKING]: '202100255Z' };
const JOB = 'system:setup-wct-sister-orgs';
const MODULES_ON = new Set(['ACCOUNTING', 'USER_MANAGEMENT']); // User Management: finance@ adds her own accounting staff (owner 2026-11-06)
// Off: WCT-only features and the ones that belong to modules that are off.
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
];
const ROLES = ['superadmin', 'Admin', 'Accounting', 'Viewer'];
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
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(MODE === 'dry' ? 'BEGIN READ ONLY' : 'BEGIN');
  if (MODE !== 'dry') await c.query(`SET LOCAL idle_in_transaction_session_timeout = '15min'`);
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const one = async (sql: string, p: any[] = []) => (await q(sql, p))[0] ?? null;
  const written: Record<string, Array<{ id: string; org: string }>> = {};
  const typeCache: Record<string, Record<string, string>> = {};
  const reqCache: Record<string, string[]> = {};
  // Columns an insert must give (NOT NULL, no default): checked in every mode, so the dry run catches a miss.
  const required = async (t: string) =>
    (reqCache[t] ??= (await q(`select column_name c from information_schema.columns where table_schema='public' and table_name=$1 and is_nullable='NO' and column_default is null`, [t])).map((r: any) => r.c));
  const colTypes = async (t: string) =>
    (typeCache[t] ??= Object.fromEntries(
      (await q(`select column_name c, data_type d from information_schema.columns where table_schema='public' and table_name=$1`, [t])).map((r: any) => [r.c, r.d]),
    ));
  const ins = async (t: string, row: Record<string, any>) => {
    const ct = await colTypes(t);
    const keys = Object.keys(row).filter((k) => k in ct && row[k] !== undefined);
    const miss = (await required(t)).filter((k) => row[k] === null || row[k] === undefined);
    if (miss.length) stop(`${t}: no value for required column(s) ${miss.join(', ')}`);
    // json / jsonb columns take JSON text (arrays included); Postgres array columns take JS arrays.
    const vals = keys.map((k) => (row[k] === null || row[k] === undefined ? null : ct[k] === 'json' || ct[k] === 'jsonb' ? JSON.stringify(row[k]) : row[k]));
    if (MODE !== 'dry') await c.query(`insert into "${t}" (${keys.map((k) => `"${k}"`).join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, vals);
    (written[t] ??= []).push({ id: row.id, org: t === 'Organization' ? row.id : row.organizationId });
  };
  const copyOf = (src: any, org: string, over: Record<string, any>) => {
    const now = new Date();
    return { ...src, id: randomUUID(), organizationId: org, createdAt: now, updatedAt: now, ...over };
  };

  out(`WCT SISTER ORGS SETUP: ${MODE === 'dry' ? 'DRY RUN (read only; nothing is written)' : MODE === 'rehearse' ? 'REHEARSAL (writes, then ROLLBACK)' : 'APPLY'}`);
  out(`db ${new URL(url).host.split('.')[0]} · run at ${new Date().toISOString()}`);
  const wct = await one(`select * from "Organization" where id=$1`, [WCT]);
  if (!wct) throw new Error('WCT not found');

  const TABLES = ['Organization', 'OrganizationUIConfig', 'OrganizationModule', 'Role', 'AccountingSetting', 'ChartOfAccount', 'TaxRate', 'DocumentNumberFormat', 'DocumentTemplate', 'UserOrganization', 'UserRole'];
  const snapshot = async () => {
    const s: Record<string, string> = {};
    for (const t of TABLES) {
      const orgCol = t === 'Organization' ? 'id' : '"organizationId"';
      const r = await one(
        `select count(*)::int n, md5(coalesce(string_agg(${orgCol}::text || ':' || coalesce(${t === 'UserRole' ? '"createdAt"' : '"updatedAt"'}::text,''), ',' order by id), '')) h
           from "${t}" where not (${orgCol}::text = any($1::text[]))`,
        [NEW_IDS],
      );
      s[t] = `${r.n}/${r.h}`;
    }
    s._PermissionToRole = String((await one(`select count(*)::int n from "_PermissionToRole" where "B" not in (select id from "Role" where "organizationId" = any($1::text[]))`, [NEW_IDS])).n);
    return s;
  };
  const before = await snapshot();

  // ── 0. Checks ──
  out('\n== 0. Checks');
  for (const [id, uen] of Object.entries(UENS)) {
    const o = await one(`select name, "registrationNumber" from "Organization" where id=$1`, [id]);
    if (o?.registrationNumber === uen) out(`  ${o.name}: UEN ${uen} ✓`);
    else stop(`${o?.name ?? id}: UEN is "${o?.registrationNumber ?? ''}", expected ${uen}`);
  }
  for (const o of NEW_ORGS) {
    const taken = await q(`select id, name from "Organization" where id=$1 or lower(name)=lower($2) or "registrationNumber"=$3`, [o.id, o.name, o.uen]);
    if (taken.length) stop(`already exists: ${taken.map((t: any) => `${t.name} ${t.id}`).join(', ')}`);
    else out(`  ${o.name} / ${o.uen} / ${o.id}: free`);
  }
  const wctAcct = await one(`select "taxRegistrationNumber" from "AccountingSetting" where "organizationId"=$1`, [WCT]);
  const gstNo = wctAcct?.taxRegistrationNumber ?? null;
  const ui = await one(`select * from "OrganizationUIConfig" where "organizationId"=$1`, [WCT]);
  const mods = await q(`select * from "OrganizationModule" where "organizationId"=$1 order by "sortOrder", "moduleCode"`, [WCT]);
  const wctRoles = await q(`select r.*, (select array_agg(pr."A") from "_PermissionToRole" pr where pr."B"=r.id) perms from "Role" r where r."organizationId"=$1 and r.name = any($2::text[]) order by r.name`, [WCT, ROLES]);
  const allPerms = (await q(`select id from "Permission"`)).map((p: any) => p.id as string);
  const tax = await q(`select * from "TaxRate" where "organizationId"=$1 order by code`, [WCT]);
  const racking = await q(`select code, name from "ChartOfAccount" where "organizationId"=$1 order by code`, [WCT_RACKING]);
  const want = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a.name]));
  const rackingIsDefault = racking.length === want.size && racking.every((a: any) => want.get(a.code) === a.name);
  out(`  WCT Racking's chart = the AIMS default SG chart (${DEFAULT_CHART_OF_ACCOUNTS.length} accounts): ${rackingIsDefault ? 'yes' : 'NO'}`);
  const admins = await q(`select distinct ur."userId" from "UserRole" ur join "Role" r on r.id=ur."roleId" where ur."organizationId"=$1 and ur."isActive" and r.name='superadmin'`, [OSIRIS_ORG_ID]);
  const fin = await q(`select distinct "actorId" id from "ActionLog" where lower("actorEmail")=$1 and "actorType"='USER'`, [FINANCE_EMAIL]);
  if (fin.length !== 1) stop(`expected one AIMS user for ${FINANCE_EMAIL}, found ${fin.length}`);
  const financeId = fin[0]?.id as string;

  // ── per org ──
  for (const o of NEW_ORGS) {
    out(`\n######## ${o.name} (UEN ${o.uen}, id ${o.id})`);
    const now = new Date();
    await ins('Organization', {
      id: o.id,
      name: o.name,
      createdAt: now,
      updatedAt: now,
      address: wct.address,
      phoneNumber: wct.phoneNumber,
      registrationNumber: o.uen,
      taxRate: 9,
      taxApplicable: true,
      absorbTax: false,
      defaultCurrency: 'SGD',
    });
    out(`  1. Organization: address "${wct.address}" · phone ${wct.phoneNumber} (WCT's placeholders) · SGD · GST 9%`);

    const features: Record<string, boolean> = { ...DEFAULT_ORG_FEATURES };
    for (const f of FLAGS_OFF) features[f] = false;
    await ins('OrganizationUIConfig', copyOf({}, o.id, { features, currency: 'SGD' }));
    const on = Object.keys(features).filter((k) => features[k]);
    out(`  2. Feature flags on (${on.length}): ${on.join(', ')}`);
    out(`     off: everything else, incl. ${FLAGS_OFF.join(', ')}`);

    const onMods: string[] = [];
    for (const m of mods) {
      const enabled = MODULES_ON.has(m.moduleCode);
      if (enabled) onMods.push(m.moduleCode);
      await ins('OrganizationModule', copyOf(m, o.id, { enabled }));
    }
    out(`  3. Modules ON: ${onMods.join(', ')} · OFF: ${mods.filter((m: any) => !MODULES_ON.has(m.moduleCode)).map((m: any) => m.moduleCode).join(', ')}`);
    if (onMods.length !== MODULES_ON.size) stop(`WCT is missing a module row to copy (${[...MODULES_ON].join(', ')})`);

    const roleIds: Record<string, string> = {};
    const roleLine: string[] = [];
    for (const name of ROLES) {
      const src = wctRoles.find((r: any) => r.name === name);
      const perms: string[] = name === 'superadmin' ? allPerms : src?.perms ?? [];
      if (!src && name !== 'superadmin') { stop(`WCT has no ${name} role`); continue; }
      const allowed = Array.isArray(src?.allowedModules) && src.allowedModules.length ? src.allowedModules.filter((x: string) => MODULES_ON.has(x)) : [];
      const row = copyOf(src ? { ...src } : { name }, o.id, { allowedModules: allowed });
      delete (row as any).perms;
      roleIds[name] = row.id;
      await ins('Role', row);
      for (const p of perms) {
        if (MODE !== 'dry') await c.query(`insert into "_PermissionToRole" ("A","B") values ($1,$2)`, [p, row.id]);
        (written._PermissionToRole ??= []).push({ id: `${p}:${row.id}`, org: o.id });
      }
      roleLine.push(`${name} (${perms.length} perms${allowed.length ? `, modules ${allowed.join(',')}` : ''})`);
    }
    out(`  4. Roles: ${roleLine.join(' · ')}`);

    await ins('AccountingSetting', {
      id: randomUUID(),
      organizationId: o.id,
      baseCurrency: 'SGD',
      nextNumbers: DEFAULT_NEXT_NUMBERS,
      numberPrefixes: {},
      taxRegistrationNumber: gstNo,
      taxDefaultPercentage: 9,
      taxReference: 'GST',
      salesTaxInclusive: false,
      fiscalYearEndDay: 31,
      fiscalYearEndMonth: 12,
      timeZone: 'Asia/Singapore',
      accountCodeRanges: DEFAULT_ACCOUNT_CODE_RANGES,
      controlAccounts: DEFAULT_CONTROL_ACCOUNTS,
      createdAt: now,
      updatedAt: now,
    });
    for (const a of DEFAULT_CHART_OF_ACCOUNTS) {
      await ins('ChartOfAccount', {
        id: randomUUID(),
        organizationId: o.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        category: a.category,
        normalBalance: a.normalBalance,
        isControlAccount: !!a.isControlAccount,
        isSystem: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const t of tax) await ins('TaxRate', copyOf(t, o.id, {}));
    out(`  5. Accounting: SGD · GST 9% · GST reg no ${gstNo ?? '(blank: WCT has none set)'} · FY 31 Dec · default control accounts`);
    out(`     chart: AIMS default SG chart, ${DEFAULT_CHART_OF_ACCOUNTS.length} accounts (= WCT Racking's) · GST codes: ${tax.length} (WCT's, as WCT Racking got)`);

    for (const t of DEFAULT_DOCUMENT_TEMPLATES) {
      await ins('DocumentTemplate', {
        id: randomUUID(),
        organizationId: o.id,
        type: t.type,
        templateVariant: t.templateVariant,
        name: t.name,
        designName: 'Default',
        description: `${t.name} document template`,
        isActive: true,
        isDefault: true,
        config: t.config ?? undefined,
        createdAt: now,
        updatedAt: now,
      });
    }
    out(`  6. Document templates: the default set (${DEFAULT_DOCUMENT_TEMPLATES.length}) · number formats: none (normal default numbering)`);

    const member = async (userId: string, role: string) => {
      await ins('UserOrganization', { id: randomUUID(), userId, organizationId: o.id, isActive: true, createdAt: now, updatedAt: now, joinedAt: now });
      await ins('UserRole', { id: randomUUID(), userId, roleId: roleIds[role], organizationId: o.id, isActive: true, createdAt: now, assignedAt: now });
    };
    for (const a of admins) await member(a.userId, 'superadmin');
    if (financeId) await member(financeId, 'Admin');
    out(`  7. Access: Osiris superadmins -> superadmin: ${admins.length} · ${FINANCE_EMAIL} -> Admin`);
  }

  TO_CONFIRM.push(`Address and phone are WCT's: ${wct.address} · ${wct.phoneNumber}`);
  TO_CONFIRM.push(`GST registration no: WCT has none set in Accounting Setup, so both are blank (set each one's in Accounting Setup, Financial Settings)`);
  TO_CONFIRM.push('Email, website, logo, company stamp, bank / PayNow details: not set');

  // ── proof ──
  out('\n== Proof (inside the transaction)');
  let bad = 0;
  for (const [t, rows] of Object.entries(written)) {
    if (t === '_PermissionToRole') continue;
    const orgCol = t === 'Organization' ? 'id' : '"organizationId"';
    const found = MODE === 'dry' ? rows.map((r) => ({ org: r.org })) : await q(`select ${orgCol}::text org from "${t}" where id::text = any($1::text[])`, [rows.map((r) => r.id)]);
    const other = found.filter((r: any) => !NEW_IDS.includes(r.org)).length;
    const missing = rows.length - found.length;
    out(`  ${t.padEnd(22)} written ${String(rows.length).padStart(4)}  new orgs ${String(found.length - other).padStart(4)}  other org ${other}${missing ? `  MISSING ${missing}` : ''}`);
    if (other || missing) bad++;
  }
  const links = MODE === 'dry' ? written._PermissionToRole.length : Number((await one(`select count(*)::int n from "_PermissionToRole" where "B" in (select id from "Role" where "organizationId" = any($1::text[]))`, [NEW_IDS])).n);
  out(`  ${'_PermissionToRole'.padEnd(22)} written ${String(written._PermissionToRole.length).padStart(4)}  on new-org roles ${links}`);
  if (links !== written._PermissionToRole.length) bad++;
  const after = await snapshot();
  const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
  out(`  other orgs (WCT, WCT Racking included): ${changed.length ? `CHANGED in ${changed.join(', ')}` : 'unchanged in every table written'}`);
  if (changed.length || bad) stop('proof failed');
  // finance@ in all four
  const fm = MODE === 'dry' ? [] : await q(`select o.name, string_agg(r.name, ',') roles from "UserOrganization" uo join "Organization" o on o.id=uo."organizationId" left join "UserRole" ur on ur."userId"=uo."userId" and ur."organizationId"=uo."organizationId" and ur."isActive" left join "Role" r on r.id=ur."roleId" where uo."userId"=$1 and uo."isActive" group by o.name order by o.name`, [financeId]);
  if (MODE !== 'dry') out(`  ${FINANCE_EMAIL}: ${fm.map((m: any) => `${m.name} (${m.roles})`).join(' · ')}`);

  out('\n== TO CONFIRM');
  for (const t of TO_CONFIRM) out(`  - ${t}`);

  if (MODE === 'dry' || problems) {
    await c.query('ROLLBACK');
    out(`\n${problems ? `${problems} PROBLEM(S)${MODE === 'dry' ? '' : ': ROLLBACK, nothing written'}` : 'No problems found.'}${MODE === 'dry' ? ' DRY RUN: nothing was written.' : ''}`);
    await c.end();
    process.exit(problems ? 1 : 0);
  }
  for (const o of NEW_ORGS) {
    await c.query(
      `insert into "ActionLog" (id,"actorType","actorId","actorName","organizationId",channel,action,resource,details,status,"createdAt") values ($1,'SYSTEM',$2,'System creation',$3,'operator','CREATE','Organization',$4::jsonb,'SUCCESS',now())`,
      [randomUUID(), JOB, o.id, JSON.stringify({ name: o.name, uen: o.uen, modules: [...MODULES_ON], finance: FINANCE_EMAIL, toConfirm: TO_CONFIRM })],
    );
  }
  if (MODE === 'rehearse') {
    await c.query('ROLLBACK');
    out('\nREHEARSAL OK: every check passed. ROLLBACK: nothing kept.');
  } else {
    await c.query('COMMIT');
    out(`\nAPPLIED: committed (+${NEW_ORGS.length} ActionLog rows).`);
  }
  await c.end();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
