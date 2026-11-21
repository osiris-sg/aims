/**
 * Field shadow import from SiteClock (FIELD_PLAN.md §5.2). Reads one SiteClock company through a READ-ONLY
 * connection and upserts the Field* tables of one AIMS org, keyed by (organizationId, siteclockId): re-runnable,
 * never a duplicate. Never writes to SiteClock; never touches Worker / WorkerTeam / WorkerTeamMember.
 *
 *   SITECLOCK_RO_DATABASE_URL=… (set by Elroy, env only)
 *   npx ts-node scripts/field-siteclock-import.ts --env dev|prod --org <aims org id> --siteclock-company <id> --areas people --dry-run
 *   … --apply   (only after Elroy's APPLY)
 *
 * Dry run: counts per table (source / upsert / skipped with reason) and 3 masked samples each. Nothing written.
 * Apply: one transaction per area, under an advisory lock taken on apply only; log JSON in _imports/wct/logs/.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { planAttendance, type ScAttendance } from '../src/field/import/attendance-plan';
import { planJobs, type ScJobs } from '../src/field/import/jobs-plan';
import { planPeople, type PeoplePlan, type ScPeople } from '../src/field/import/people-plan';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const has = (k: string) => process.argv.includes(k);

const TABLE: Record<string, string> = {
  fieldSettings: 'FieldSettings', fieldWorkerProfile: 'FieldWorkerProfile', fieldTeamStint: 'FieldTeamStint', fieldTeamSupervisor: 'FieldTeamSupervisor',
  fieldSite: 'FieldSite', fieldSiteAssignment: 'FieldSiteAssignment', fieldTrade: 'FieldTrade', fieldWorkerTrade: 'FieldWorkerTrade',
  fieldInvite: 'FieldInvite', fieldRegistration: 'FieldRegistration', fieldPhotoUpdate: 'FieldPhotoUpdate', fieldShiftTemplate: 'FieldShiftTemplate',
  fieldShiftAssignment: 'FieldShiftAssignment', fieldManningPreset: 'FieldManningPreset', fieldDayNote: 'FieldDayNote', fieldJob: 'FieldJob',
  fieldJobCrew: 'FieldJobCrew', fieldJobNeed: 'FieldJobNeed', fieldOvertimeRule: 'FieldOvertimeRule', fieldBreakRule: 'FieldBreakRule',
  fieldTimeEntry: 'FieldTimeEntry', fieldPunch: 'FieldPunch',
};
/** The conflict key of each table (settings: one row per org; worker trades: composite). */
const KEY: Record<string, string[]> = { fieldSettings: ['organizationId'], fieldWorkerTrade: ['workerId', 'tradeId'] };
const HAS_UPDATED_AT = new Set(['fieldSettings', 'fieldWorkerProfile', 'fieldTeamStint', 'fieldSite', 'fieldInvite', 'fieldRegistration', 'fieldPhotoUpdate', 'fieldShiftTemplate', 'fieldShiftAssignment', 'fieldManningPreset', 'fieldDayNote', 'fieldJob', 'fieldOvertimeRule', 'fieldBreakRule', 'fieldTimeEntry', 'fieldPunch']);
const AREAS = ['people', 'jobs', 'attendance'];
const JSON_COLS = new Set(['items', 'leaveDays', 'faceDescriptor', 'workedFor', 'before', 'after']);

/** Masks for printed samples: names cut to initials, phones to the last 4, no face data, no tokens. */
function mask(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    if (k === 'faceDescriptor') out[k] = '[face data]';
    else if (k === 'phone') out[k] = `****${String(v).slice(-4)}`;
    else if (k === 'name' && typeof v === 'string') out[k] = v.split(/\s+/).map((p) => `${p[0]}.`).join(' ');
    else if (k === 'token' || k === 'deviceId') out[k] = '[set]';
    else out[k] = v;
  }
  return out;
}

async function readSiteClock(sc: Client, companyId: string): Promise<ScPeople> {
  const q = async (sql: string, p: unknown[] = [companyId]) => (await sc.query(sql, p)).rows;
  const [company] = await q(`select * from "Company" where id = $1`);
  if (!company) throw new Error('SiteClock company not found');
  const users = await q(
    `select u.*, r.name as "companyRoleName" from "User" u left join "CompanyRole" r on r.id = u."companyRoleId" where u."companyId" = $1`,
  );
  const teams = await q(`select id, name, active from "Team" where "companyId" = $1`);
  const teamIds = teams.map((t: any) => t.id);
  const memberships = teamIds.length ? await q(`select id, "teamId", "userId", "startDate", "endDate" from "TeamMembership" where "teamId" = any($1)`, [teamIds]) : [];
  const teamSupervisors = teamIds.length ? await q(`select id, "teamId", "userId" from "TeamSupervisor" where "teamId" = any($1)`, [teamIds]) : [];
  const sites = await q(`select * from "Site" where "companyId" = $1`);
  const siteIds = sites.map((s: any) => s.id);
  const siteAssignments = siteIds.length ? await q(`select id, "userId", "siteId", "isSupervisor" from "SiteAssignment" where "siteId" = any($1)`, [siteIds]) : [];
  const trades = await q(`select id, name from "Trade" where "companyId" = $1`);
  const userIds = users.map((u: any) => u.id);
  const userTrades = userIds.length ? await q(`select "userId", "tradeId" from "UserTrade" where "userId" = any($1)`, [userIds]) : [];
  const invites = await q(`select * from "InviteLink" where "companyId" = $1`);
  const registrations = await q(`select * from "RegistrationRequest" where "companyId" = $1`);
  const photoUpdates = await q(`select * from "PhotoUpdate" where "companyId" = $1`);
  return { company, users, teams, memberships, teamSupervisors, sites, siteAssignments, trades, userTrades, invites, registrations, photoUpdates } as ScPeople;
}

async function readSiteClockAttendance(sc: Client, companyId: string): Promise<ScAttendance> {
  const q = async (sql: string) => (await sc.query(sql, [companyId])).rows;
  return {
    overtimeRules: await q(`select * from "OvertimeRule" where "companyId" = $1`),
    breakRules: await q(`select * from "BreakRule" where "companyId" = $1`),
    entries: await q(`select * from "TimeEntry" where "companyId" = $1`),
    punches: await q(`select * from "Punch" where "companyId" = $1 order by "serverTime"`),
  };
}

async function readSiteClockJobs(sc: Client, companyId: string): Promise<ScJobs> {
  const q = async (sql: string, p: unknown[] = [companyId]) => (await sc.query(sql, p)).rows;
  const jobs = await q(`select * from "Job" where "companyId" = $1`);
  const jobIds = jobs.map((j: any) => j.id);
  const crews = jobIds.length ? await q(`select id, "jobId", "userId", "teamId", "tradeId", "notifiedAt" from "JobCrew" where "jobId" = any($1)`, [jobIds]) : [];
  const needs = jobIds.length ? await q(`select id, "jobId", "tradeId", qty from "JobNeed" where "jobId" = any($1)`, [jobIds]) : [];
  const dayNotes = await q(`select id, date, text from "DayNote" where "companyId" = $1`);
  const templates = await q(`select * from "ShiftTemplate" where "companyId" = $1`);
  const tplIds = templates.map((t: any) => t.id);
  const assignments = tplIds.length ? await q(`select id, "templateId", "userId", "startDate", "endDate" from "ShiftAssignment" where "templateId" = any($1)`, [tplIds]) : [];
  const presets = await q(`select p.id, p.name, coalesce(json_agg(json_build_object('tradeId', i."tradeId", 'qty', i.qty)) filter (where i.id is not null), '[]') as items
    from "ManningPreset" p left join "ManningPresetItem" i on i."presetId" = p.id where p."companyId" = $1 group by p.id`);
  return { jobs, crews, needs, dayNotes, templates, assignments, presets } as ScJobs;
}

(async () => {
  const env = arg('--env') ?? 'dev';
  const org = arg('--org');
  const companyId = arg('--siteclock-company');
  const apply = has('--apply');
  const dry = has('--dry-run') || !apply;
  const areas = (arg('--areas') ?? 'people').split(',');
  if (!org || !companyId) throw new Error('need --org <aims org id> and --siteclock-company <id>');
  if (!areas.every((a) => AREAS.includes(a))) throw new Error(`--areas must be some of ${AREAS.join(',')}`);
  const scUrl = process.env.SITECLOCK_RO_DATABASE_URL;
  if (!scUrl) throw new Error('SITECLOCK_RO_DATABASE_URL is not set (Elroy sets it; read-only user)');
  const aimsUrl = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!aimsUrl) throw new Error(`no AIMS database url for --env ${env}`);
  const S = env === 'prod' ? '"public"' : '"platform"';

  const sc = new Client({ connectionString: scUrl });
  const db = new Client({ connectionString: aimsUrl });
  await sc.connect();
  await db.connect();
  try {
    await sc.query('BEGIN TRANSACTION READ ONLY');
    const source = await readSiteClock(sc, companyId);
    const jobsSource = areas.includes('jobs') ? await readSiteClockJobs(sc, companyId) : null;
    const attSource = areas.includes('attendance') ? await readSiteClockAttendance(sc, companyId) : null;
    await sc.query('ROLLBACK');

    const workers = (await db.query(`select id, "siteclockId" from ${S}."Worker" where "organizationId" = $1`, [org])).rows;
    const teams = (await db.query(`select id, "siteclockId" from ${S}."WorkerTeam" where "organizationId" = $1`, [org])).rows;
    const existing: Record<string, Map<string, string>> = {};
    for (const t of ['fieldSite', 'fieldTrade', 'fieldInvite', 'fieldShiftTemplate']) {
      const rows = (await db.query(`select id, "siteclockId" from ${S}."${TABLE[t]}" where "organizationId" = $1 and "siteclockId" is not null`, [org])).rows;
      existing[t] = new Map(rows.map((r: any) => [r.siteclockId, r.id]));
    }
    const parts: PeoplePlan[] = [];
    if (areas.includes('people')) parts.push(planPeople(source, { workers, teams, existing }, org));
    if (jobsSource) parts.push(planJobs(jobsSource, { workers, teams }, org));
    if (attSource) {
      const links = (await db.query(`select "organizationId", "siteclockCompanyId" from ${S}."FieldSettings" where "siteclockCompanyId" is not null`)).rows;
      parts.push(planAttendance(attSource, { workers, orgOfCompany: new Map(links.map((r: any) => [r.siteclockCompanyId, r.organizationId])) }, org));
    }
    const plan: PeoplePlan = { upserts: parts.flatMap((p) => p.upserts), skipped: parts.flatMap((p) => p.skipped), counts: Object.assign({}, ...parts.map((p) => p.counts)) };

    console.log(`SiteClock company ${companyId} -> AIMS org ${org} (${env}), ${dry ? 'DRY RUN' : 'APPLY'}`);
    console.table(Object.fromEntries(Object.entries(plan.counts).map(([t, c]) => [t, c])));
    const byTable = new Map<string, any[]>();
    for (const u of plan.upserts) byTable.set(u.table, [...(byTable.get(u.table) ?? []), u]);
    for (const [t, rows] of byTable) {
      console.log(`\n${t}: samples`);
      for (const r of rows.slice(0, 3)) console.log(' ', JSON.stringify(mask(r.data)).slice(0, 400));
    }
    if (plan.skipped.length) {
      console.log('\nskipped:');
      for (const s of plan.skipped) console.log(`  ${s.table} ${s.siteclockId}: ${s.reason.replace(/^[^:]+:/, (m) => mask({ name: m.slice(0, -1) }).name + ':')}`);
    }
    if (dry) return;

    // APPLY: one transaction, advisory lock taken here only and released explicitly (memory pooled-advisory-lock).
    await db.query('BEGIN');
    await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [`field-import:${org}`]);
    const resolved = new Map<string, string>(); // "new:table:scId" -> id
    const resolve = async (v: unknown): Promise<unknown> => {
      if (Array.isArray(v)) return (await Promise.all(v.map(resolve))).filter((x) => x != null);
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const o: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) o[k] = await resolve(x);
        return o;
      }
      if (typeof v !== 'string' || !v.startsWith('new:')) return v;
      if (resolved.has(v)) return resolved.get(v)!;
      const [, table, scId] = v.split(':');
      const r = await db.query(`select id from ${S}."${TABLE[table]}" where "organizationId" = $1 and "siteclockId" = $2`, [org, scId]);
      return r.rows[0]?.id ?? null; // a table of a later phase (shift templates): null until it is imported
    };
    let written = 0;
    for (const u of plan.upserts) {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(u.data)) data[k] = await resolve(v);
      if (typeof data.id === 'string' && (data.id as string).startsWith('new:')) data.id = undefined;
      if (u.table === 'fieldWorkerTrade' || u.table === 'fieldSettings') delete data.siteclockId; // no such column (keyed otherwise)
      if (data.id === undefined || data.id === null) {
        if (u.table !== 'fieldWorkerTrade') data.id = randomUUID();
        else delete data.id;
      }
      if (HAS_UPDATED_AT.has(u.table)) data.updatedAt = new Date();
      const cols = Object.keys(data).filter((k) => data[k] !== undefined);
      const key = KEY[u.table] ?? ['organizationId', 'siteclockId'];
      const sets = cols.filter((c) => !key.includes(c) && c !== 'id' && c !== 'createdAt').map((c) => `"${c}" = excluded."${c}"`);
      const sql = `insert into ${S}."${TABLE[u.table]}" (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
        on conflict (${key.map((k) => `"${k}"`).join(', ')}) do ${sets.length ? `update set ${sets.join(', ')}` : 'nothing'} returning id`;
      // Json columns go as JSON text (an array there is JSON, not a Postgres array); String[] / Int[] columns stay arrays.
      const params = cols.map((c) => (JSON_COLS.has(c) && data[c] != null ? JSON.stringify(data[c]) : data[c] !== null && typeof data[c] === 'object' && !(data[c] instanceof Date) && !Array.isArray(data[c]) ? JSON.stringify(data[c]) : data[c]));
      const r = await db.query(sql, params);
      const id = r.rows[0]?.id;
      if (id && ['fieldSite', 'fieldTrade', 'fieldInvite', 'fieldShiftTemplate', 'fieldShiftAssignment', 'fieldJob', 'fieldTimeEntry'].includes(u.table)) resolved.set(`new:${u.table}:${u.siteclockId}`, id);
      written++;
    }
    await db.query('COMMIT');
    const dir = join(__dirname, '../../_imports/wct/logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `field-siteclock-import.${env}.${new Date().toISOString().replace(/[:.]/g, '-')}.log.json`);
    writeFileSync(file, JSON.stringify({ env, org, companyId, areas, counts: plan.counts, skipped: plan.skipped, written }, null, 2));
    console.log(`\nAPPLIED: ${written} rows upserted. Log ${file}`);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await sc.end();
    await db.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
