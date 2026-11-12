/**
 * READ-ONLY guard for the WCT group work (2026-11-12): snapshot every org
 * OUTSIDE the WCT group (feature flags, module rows, roles + their permission
 * ids, template design hashes, document number formats), then compare a later
 * run against it. Proves that no other org changed in flags, settings or
 * templates. Nothing is written to the database.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/check-non-wct-orgs-unchanged.ts --snapshot=<file>
 *   DBURL=<prod> npx ts-node --transpile-only scripts/check-non-wct-orgs-unchanged.ts --compare=<file>
 *
 * Dev (per-org tenancy) is not covered: it reads the public schema only.
 * Number-format rows carry nextSerial, which moves with normal use; the compare
 * reports those separately from setting changes.
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { Client } from 'pg';

const WCT_GROUP = [
  '5c700000-0000-4000-8000-5c7000000001',
  '5c700000-0000-4000-8000-5c7000000002',
  '5c700000-0000-4000-8000-5c7000000003',
  '5c700000-0000-4000-8000-5c7000000004',
];

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 16);

type Snap = Record<string, { name: string; features: Record<string, unknown>; modules: Record<string, unknown>; roles: Record<string, unknown>; templates: Record<string, string>; formats: Record<string, unknown>; serials: Record<string, number> }>;

async function snapshot(c: Client): Promise<Snap> {
  const orgs = (await c.query(`select id, name from "Organization" where id <> all($1) order by name`, [WCT_GROUP])).rows;
  const ids = orgs.map((o) => o.id);
  const ui = (await c.query(`select "organizationId", features from "OrganizationUIConfig" where "organizationId" = any($1)`, [ids])).rows;
  const mods = (await c.query(`select "organizationId", "moduleCode", enabled, "displayName", icon, "sortOrder", config from "OrganizationModule" where "organizationId" = any($1)`, [ids])).rows;
  const roles = (await c.query(
    `select r."organizationId", r.name, r.description, r."allowedModules", coalesce(array_agg(pr."A" order by pr."A") filter (where pr."A" is not null), '{}') perms
     from "Role" r left join "_PermissionToRole" pr on pr."B" = r.id where r."organizationId" = any($1) group by r.id`,
    [ids],
  )).rows;
  const tpls = (await c.query(`select id, "organizationId", type, name, "templateVariant", "isActive", "isDefault", config, "styleConfig", "layoutConfig" from "DocumentTemplate" where "organizationId" = any($1)`, [ids])).rows;
  const fmts = (await c.query(`select id, "organizationId", "documentType", label, pattern, "nextSerial", "resetPolicy", "isActive", "sortOrder" from "DocumentNumberFormat" where "organizationId" = any($1)`, [ids])).rows;
  const snap: Snap = {};
  for (const o of orgs) snap[o.id] = { name: o.name, features: {}, modules: {}, roles: {}, templates: {}, formats: {}, serials: {} };
  for (const u of ui) snap[u.organizationId].features = u.features ?? {};
  for (const m of mods) snap[m.organizationId].modules[m.moduleCode] = { enabled: m.enabled, displayName: m.displayName, icon: m.icon, sortOrder: m.sortOrder, config: hash(m.config) };
  for (const r of roles) snap[r.organizationId].roles[r.name] = { description: r.description, allowedModules: r.allowedModules, perms: hash(r.perms), permCount: r.perms.length };
  for (const t of tpls) snap[t.organizationId].templates[t.id] = hash([t.type, t.name, t.templateVariant, t.isActive, t.isDefault, t.config, t.styleConfig, t.layoutConfig]);
  for (const f of fmts) {
    snap[f.organizationId].formats[f.id] = { documentType: f.documentType, label: f.label, pattern: f.pattern, resetPolicy: f.resetPolicy, isActive: f.isActive, sortOrder: f.sortOrder };
    snap[f.organizationId].serials[f.id] = f.nextSerial;
  }
  return snap;
}

function diff(before: Snap, after: Snap): { settings: string[]; serials: string[] } {
  const settings: string[] = [];
  const serials: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of keys) {
    const b = before[id], a = after[id];
    const name = (a ?? b).name;
    if (!b) { settings.push(`${name}: new org`); continue; }
    if (!a) { settings.push(`${name}: org gone`); continue; }
    for (const part of ['features', 'modules', 'roles', 'templates', 'formats'] as const) {
      const pk = new Set([...Object.keys(b[part]), ...Object.keys(a[part])]);
      for (const k of pk) {
        const x = JSON.stringify((b[part] as any)[k] ?? null), y = JSON.stringify((a[part] as any)[k] ?? null);
        if (x !== y) settings.push(`${name}: ${part}.${k} ${x} -> ${y}`);
      }
    }
    for (const k of new Set([...Object.keys(b.serials), ...Object.keys(a.serials)])) {
      if (b.serials[k] !== a.serials[k]) serials.push(`${name}: number format ${k} nextSerial ${b.serials[k]} -> ${a.serials[k]} (normal use)`);
    }
  }
  return { settings, serials };
}

(async () => {
  const url = process.env.DBURL || process.env.DATABASE_URL || '';
  if (!url) throw new Error('Pass DBURL (prod) or set DATABASE_URL');
  const snapFile = arg('snapshot'), cmpFile = arg('compare');
  if (!snapFile && !cmpFile) throw new Error('Pass --snapshot=<file> or --compare=<file>');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const now = await snapshot(c);
    if (snapFile) {
      fs.writeFileSync(snapFile, JSON.stringify({ takenAt: new Date().toISOString(), orgs: now }, null, 1));
      console.log(`Snapshot of ${Object.keys(now).length} non-WCT-group orgs written to ${snapFile}`);
    }
    if (cmpFile) {
      const before = JSON.parse(fs.readFileSync(cmpFile, 'utf8'));
      const { settings, serials } = diff(before.orgs, now);
      console.log(`Compared ${Object.keys(now).length} non-WCT-group orgs against ${cmpFile} (${before.takenAt})`);
      console.log(settings.length ? `SETTING CHANGES (${settings.length}):\n  ${settings.join('\n  ')}` : 'No setting changes in any non-WCT-group org.');
      if (serials.length) console.log(`Number counters moved by normal use (${serials.length}):\n  ${serials.join('\n  ')}`);
      if (settings.length) process.exitCode = 2;
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
