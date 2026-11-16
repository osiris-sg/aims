/**
 * BC Air parity with WCT (S) (2026-11-16): BC Air ONLY
 * (5c700000-0000-4000-8000-5c7000000004). Racking, YMM and every other org untouched.
 *
 *   features.enableManualOrderFlow      -> true   (dashboard order flow: Complete DO, invoice / DO in either order, SR on the order)
 *   features.disableAutoCustomerEmails  -> true   (no automatic customer emails, as WCT)
 *   features.serviceReportTemplate      -> 'BCAIR' (BC Air's service report: letterhead + wording)
 *   Organization.logo                   -> BC Air's logo (from its SR master), ONLY if empty (uploaded to S3)
 *   Organization.email                  -> admin@bcair.com.sg (Elroy 16 Nov), ONLY if empty
 *                                          (the SR letter keeps info@bcair.com.sg from the master, in code)
 *   OrganizationModule INVENTORY, SUPPLIERS -> enabled (BC Air sells products; Elroy 16 Nov)
 *
 * Fill-empty / set-new only: a value already set differently is reported and
 * left as it is. Dry run by default (prints the diff); --apply writes, with one
 * "System creation" Activity Log row per change and a local log file.
 *
 *   npx ts-node --transpile-only scripts/wct-bcair-parity.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-bcair-parity.ts --env prod --apply
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const FEATURES: Record<string, unknown> = { enableManualOrderFlow: true, disableAutoCustomerEmails: true, serviceReportTemplate: 'BCAIR' };
const EMAIL = 'admin@bcair.com.sg';
const MODULES = ['INVENTORY', 'SUPPLIERS'];
const LOGO_FILE = `${__dirname}/assets/bcair-logo.png`;
const LOGO_KEY = `organizations/${BCAIR}/logo-bcair.png`;

const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev';
const apply = process.argv.includes('--apply');

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const S = env === 'prod' ? '"public"' : '"platform"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const org = (await q(`select id, name, email, logo from ${S}."Organization" where id = $1`, [BCAIR]))[0];
  if (!org) throw new Error('BC Air org not found');
  const ui = (await q(`select id, features from ${S}."OrganizationUIConfig" where "organizationId" = $1`, [BCAIR]))[0];
  if (!ui) throw new Error('BC Air has no OrganizationUIConfig row');
  const f = (ui.features || {}) as Record<string, unknown>;

  const plan: Array<{ what: string; from: unknown; to: unknown; skip?: string }> = [];
  for (const [k, v] of Object.entries(FEATURES)) {
    if (f[k] === v) plan.push({ what: `features.${k}`, from: f[k], to: v, skip: 'already set' });
    else if (f[k] !== undefined && f[k] !== null && f[k] !== false) plan.push({ what: `features.${k}`, from: f[k], to: v, skip: 'set to something else: left as it is' });
    else plan.push({ what: `features.${k}`, from: f[k] ?? '(not set)', to: v });
  }
  plan.push(org.email ? { what: 'Organization.email', from: org.email, to: EMAIL, skip: org.email === EMAIL ? 'already set' : 'set to something else: left as it is' } : { what: 'Organization.email', from: '(empty)', to: EMAIL });
  const mods = await q(`select id, "moduleCode" code, enabled from ${S}."OrganizationModule" where "organizationId" = $1 and "moduleCode" = any($2)`, [BCAIR, MODULES]);
  for (const m of MODULES) {
    const r = mods.find((x: any) => x.code === m);
    plan.push(!r ? { what: `module.${m}`, from: '(no row)', to: true, skip: 'no module row: not created by this script' } : r.enabled ? { what: `module.${m}`, from: true, to: true, skip: 'already on' } : { what: `module.${m}`, from: false, to: true });
  }
  plan.push(org.logo ? { what: 'Organization.logo', from: org.logo, to: LOGO_KEY, skip: 'already has a logo: left as it is' } : { what: 'Organization.logo', from: '(empty)', to: `${LOGO_KEY} (uploaded from scripts/assets/bcair-logo.png)` });

  console.log(`${env.toUpperCase()} ${org.name} (${BCAIR}):`);
  for (const p of plan) console.log(`  ${p.skip ? 'SKIP' : 'SET '} ${p.what}: ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}${p.skip ? `  (${p.skip})` : ''}`);
  const todo = plan.filter((p) => !p.skip);
  if (!apply) {
    console.log(`DRY RUN: ${todo.length} change(s), nothing written. Re-run with --apply.`);
    await c.end();
    return;
  }

  // The logo goes to S3 first (outside the transaction); the row is only pointed at it if that worked.
  const logoTodo = todo.find((p) => p.what === 'Organization.logo');
  if (logoTodo) {
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1' });
    await s3.send(new PutObjectCommand({ Bucket: process.env.RESOURCE_BUCKET || 'aims-osiris', Key: LOGO_KEY, Body: fs.readFileSync(LOGO_FILE), ContentType: 'image/png' }));
  }
  await c.query('begin');
  try {
    const feats = { ...f };
    for (const p of todo.filter((x) => x.what.startsWith('features.'))) feats[p.what.slice(9)] = p.to;
    if (todo.some((x) => x.what.startsWith('features.'))) await c.query(`update ${S}."OrganizationUIConfig" set features = $2 where id = $1`, [ui.id, JSON.stringify(feats)]);
    if (todo.some((x) => x.what === 'Organization.email')) await c.query(`update ${S}."Organization" set email = $2 where id = $1 and email is null`, [BCAIR, EMAIL]);
    for (const p of todo.filter((x) => x.what.startsWith('module.'))) await c.query(`update ${S}."OrganizationModule" set enabled = true, "updatedAt" = now() where "organizationId" = $1 and "moduleCode" = $2 and enabled = false`, [BCAIR, p.what.slice(7)]);
    if (logoTodo) await c.query(`update ${S}."Organization" set logo = $2 where id = $1 and logo is null`, [BCAIR, LOGO_KEY]);
    for (const p of todo) {
      await c.query(
        `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-bcair-parity', 'System creation', $1, 'operator', 'UPDATE', $2, $1, $3, 'SUCCESS')`,
        [BCAIR, p.what.startsWith('features.') ? 'organization-features' : p.what.startsWith('module.') ? 'organization-module' : 'organization', JSON.stringify({ note: `${p.what}: ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)} (BC Air parity, Elroy 16 Nov)` })],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(`${__dirname}/wct-bcair-parity.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), org: BCAIR, applied: todo }, null, 2));
  console.log(`APPLIED: ${todo.length} change(s) on ${org.name}.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
