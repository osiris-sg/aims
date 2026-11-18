/**
 * WCT Racking letterhead email / website (2026-11-18). WCT Racking Pte Ltd ONLY; dry run by default.
 * Organization.email / .website print on the letterhead of its quotations, invoices, DOs and service
 * reports; nothing sends mail from them.
 *
 *   DBURL=<url> node scripts/wct-racking-letterhead.js --email <address|keep> --website <url|none|keep> [--apply --confirm-prod]
 *   DBURL=<url> node scripts/wct-racking-letterhead.js --rollback [--apply --confirm-prod]
 * One "System creation" ActionLog row per field changed; scripts/wct-racking-letterhead.log.json.
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');

const RK = '5c700000-0000-4000-8000-5c7000000002';
const LOG = __dirname + '/wct-racking-letterhead.log.json';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL.replace(/["\r]/g, '')).host.replace('-pooler', '') : '';
  const isProd = new URL(url).host.replace('-pooler', '') === prodHost;
  if (APPLY && isProd && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const org = (await c.query(`select id, name, email, website from "Organization" where id=$1`, [RK])).rows[0];
  if (!org || org.name !== 'WCT Racking Pte Ltd') throw new Error('WCT Racking org not found');
  const before = { email: org.email, website: org.website };
  let target;
  if (ROLLBACK) target = JSON.parse(fs.readFileSync(LOG, 'utf8')).before;
  else {
    const e = arg('--email');
    const w = arg('--website');
    if (!e || !w) throw new Error('--email <address|keep> and --website <url|none|keep> are both required');
    if (e !== 'keep' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error(`not an email: ${e}`);
    target = { email: e === 'keep' ? before.email : e, website: w === 'keep' ? before.website : w === 'none' ? null : w };
  }
  const changes = ['email', 'website'].filter((k) => (before[k] ?? null) !== (target[k] ?? null));
  console.log(`WCT Racking letterhead (${isProd ? 'PROD' : 'non-prod'}):`);
  for (const k of ['email', 'website']) console.log(`  ${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(target[k])}${changes.includes(k) ? '' : ' (no change)'}`);
  if (!changes.length) { console.log('nothing to do'); await c.end(); return; }
  if (!APPLY) { console.log('DRY RUN: no write.'); await c.end(); return; }
  await c.query('begin');
  for (const k of changes) {
    await c.query(`update "Organization" set ${k === 'email' ? 'email' : 'website'}=$2 where id=$1`, [RK, target[k]]);
    await c.query(
      `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-racking-letterhead', 'System creation', $1, 'operator', 'UPDATE', 'organization', $2, 'SUCCESS')`,
      [RK, JSON.stringify({ note: `${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(target[k])} (Racking letterhead)` })],
    );
  }
  await c.query('commit');
  if (!ROLLBACK) fs.writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), before, after: target }, null, 2));
  console.log(`APPLIED: ${changes.join(', ')}`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
