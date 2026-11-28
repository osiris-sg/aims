/**
 * WCT group: the Sales Person of old-ERP quotations and their invoices (guru 2026-11-28).
 *
 * The old ERP left "Sales Person" empty on the quotations a salesperson keyed in themselves and
 * kept only their login (config.erpImport.coordinator). Checked against the office's own July 2026
 * commission sheets: every quotation keyed by "joyna" is on Joyna's sheet, every "ravewct" one on
 * Rave's, "nathan" on Nat's (47 of 47, plus the jobs they share with Henry). So:
 *
 *   step 1  QUOTATION with an EMPTY Sales Person whose login is a salesperson's  → that person
 *           joyna → Joyna · ravewct → Rave · neemengwct → Nee Meng · nathan → Nat
 *           An office login (kherrywct, joanne ooi, jeffwct, jessy lim …) names nobody: left empty.
 *   step 2  INVOICE with an EMPTY Sales Person that sits on an order → the Sales Person of that
 *           order's quotation (as it reads after step 1; "Henry & Rave" is copied as written).
 *
 * Fills EMPTY fields only; a field with anything in it is never touched. Every document changed is
 * stamped config.salesPersonFilled { from, batch } and listed in a backup file, and --rollback
 * empties again exactly those that still hold what this run wrote. No amounts, statuses or
 * journals are involved; updatedAt is left alone so lists do not reorder.
 *
 * DRY RUN BY DEFAULT (read-only session).
 *   node scripts/wct-salesperson-from-erp-login.js --org wct   --env prod
 *   node scripts/wct-salesperson-from-erp-login.js --org wct   --env prod --apply --confirm-prod
 *   node scripts/wct-salesperson-from-erp-login.js --org wct   --env prod --rollback <backup.json> [--apply --confirm-prod]
 *   (--org bcair for BC Air / WCT Cleaning)
 *   --since YYYY-MM-DD   only documents dated on or after this day (the login rule was checked against
 *                        July 2026 sheets; how far back it holds is the office's to say)
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ORGS = {
  wct: { id: '5c700000-0000-4000-8000-5c7000000001', label: 'WCT (S) Systems', schema: 'org_wct' },
  bcair: { id: '5c700000-0000-4000-8000-5c7000000004', label: 'BC AIR', schema: null },
};
const LOGINS = { joyna: 'Joyna', ravewct: 'Rave', neemengwct: 'Nee Meng', nathan: 'Nat' };
const BATCH = 'salesperson-from-erp-login-2026-11-28';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENV = opt('--env', 'prod');
const KEY = opt('--org', '');
const ORG = ORGS[KEY];
const APPLY = args.includes('--apply');
const ROLLBACK = opt('--rollback', null);
const SINCE = opt('--since', null);
if (SINCE && !/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) { console.error('--since YYYY-MM-DD'); process.exit(1); }
if (!ORG) { console.error('--org wct | bcair'); process.exit(1); }
if (!['dev', 'prod'].includes(ENV)) { console.error('--env dev | prod'); process.exit(1); }
if (ENV === 'prod' && APPLY && !args.includes('--confirm-prod')) { console.error('--apply on prod needs --confirm-prod'); process.exit(1); }
if (ENV === 'dev' && !ORG.schema) { console.error(`${ORG.label} does not exist on dev`); process.exit(1); }
const prodUrl = () => process.env.PROD_DATABASE_URL || require('dotenv').parse(fs.readFileSync(__dirname + '/../.env.production')).DATABASE_URL;
const URL_ = ENV === 'prod' ? prodUrl() : process.env.DATABASE_URL;
if (!URL_ || !new URL(URL_).host.includes(ENV === 'prod' ? 'ep-icy-moon' : 'ep-steep-truth')) { console.error(`no ${ENV} database url`); process.exit(1); }

const EMPTY = `COALESCE(trim(d.config->>'salesPerson'), '') = '' AND COALESCE(trim(d.config->'documentInfo'->>'salesPerson'), '') = ''`;
// SINCE is checked above to be a plain date, so it is safe inside the SQL text.
const DATED = SINCE ? ` AND COALESCE(d.config->>'date', '') >= '${SINCE}'` : '';

(async () => {
  const c = new Client({ connectionString: URL_ });
  await c.connect();
  if (ENV === 'dev') await c.query(`SET search_path TO "${ORG.schema}", "platform", "public"`);
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  const q = async (s, p) => (await c.query(s, p)).rows;
  const log = (action, note, extra = {}) => c.query(
    `INSERT INTO "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
     VALUES (gen_random_uuid(), 'SYSTEM', 'system:wct-salesperson-from-erp-login', 'System creation', $1, 'operator', $2, 'documents', $3, 'SUCCESS')`,
    [ORG.id, action, JSON.stringify({ note, ...extra })]);
  console.log(`==== ${ORG.label} · Sales Person from the old ERP login · ${ENV}${SINCE ? ` · since ${SINCE}` : ''} · ${ROLLBACK ? 'ROLLBACK · ' : ''}${APPLY ? 'APPLY' : 'DRY RUN'} ====`);

  if (ROLLBACK) {
    const b = JSON.parse(fs.readFileSync(path.resolve(ROLLBACK), 'utf8'));
    if (b.org !== ORG.id || b.env !== ENV) throw new Error('this backup is for another org / env');
    const now = new Map((await q(`SELECT id::text, COALESCE(config->>'salesPerson', '') sp, config->'salesPersonFilled'->>'batch' batch FROM "Document" WHERE "organizationId" = $1 AND id::text = ANY($2::text[])`, [ORG.id, b.rows.map((r) => r.id)])).map((r) => [r.id, r]));
    // Only what still reads as this run wrote it: a name someone changed since is theirs.
    const todo = b.rows.filter((r) => now.get(r.id)?.sp === r.after && now.get(r.id)?.batch === b.batch);
    console.log(`backup has ${b.rows.length} documents · ${todo.length} still as written and to empty again · ${b.rows.length - todo.length} changed since or gone (left alone)`);
    if (!APPLY || !todo.length) { console.log(APPLY ? 'nothing to roll back' : 'DRY RUN: no write.'); await c.end(); return; }
    await c.query('BEGIN');
    const r = await c.query(`UPDATE "Document" SET config = jsonb_set(config, '{salesPerson}', '""'::jsonb) - 'salesPersonFilled' WHERE "organizationId" = $1 AND id::text = ANY($2::text[])`, [ORG.id, todo.map((x) => x.id)]);
    await log('UPDATE', `Sales Person emptied again on ${r.rowCount} documents (rollback of ${b.batch})`);
    await c.query('COMMIT');
    console.log(`ROLLED BACK ${r.rowCount} documents`);
    await c.end();
    return;
  }

  // ── step 1: quotations ──
  const quotes = await q(
    `SELECT d.id::text, d.name, lower(trim(d.config->'erpImport'->>'coordinator')) login, left(COALESCE(d.config->>'date', ''), 4) yr
       FROM "Document" d
      WHERE d."organizationId" = $1 AND d.type = 'QUOTATION' AND ${EMPTY}${DATED}
        AND lower(trim(d.config->'erpImport'->>'coordinator')) = ANY($2::text[])`,
    [ORG.id, Object.keys(LOGINS)]);
  const plan = quotes.map((r) => ({ id: r.id, type: 'QUOTATION', name: r.name, after: LOGINS[r.login], from: `erp login ${r.login}`, yr: r.yr }));
  const tally = (rows, f) => { const t = {}; for (const r of rows) t[f(r)] = (t[f(r)] || 0) + 1; return Object.entries(t).sort().map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'; };
  console.log(`\nstep 1 · quotations with an empty Sales Person and a salesperson's login: ${plan.length}`);
  console.log(`  by person: ${tally(plan, (r) => r.after)}`);
  console.log(`  by year:   ${tally(plan, (r) => r.yr || '(no date)')}`);
  const left = await q(
    `SELECT COALESCE(NULLIF(lower(trim(d.config->'erpImport'->>'coordinator')), ''), '(no login)') login, count(*)::int n
       FROM "Document" d WHERE d."organizationId" = $1 AND d.type = 'QUOTATION' AND ${EMPTY}
        AND NOT (lower(trim(COALESCE(d.config->'erpImport'->>'coordinator', ''))) = ANY($2::text[])) GROUP BY 1 ORDER BY 2 DESC`,
    [ORG.id, Object.keys(LOGINS)]);
  console.log(`  left empty (the login is not a salesperson's): ${left.map((r) => `${r.login} ${r.n}`).join(' · ') || 'none'}`);

  // ── step 2: invoices on an order, from that order's quotation (as it reads after step 1) ──
  const filled = new Map(plan.map((r) => [r.id, r.after]));
  const invs = await q(
    `SELECT d.id::text, d.name, left(COALESCE(d.config->>'date', ''), 4) yr, o."sourceQuotationId"::text quote,
            COALESCE(NULLIF(trim(qd.config->>'salesPerson'), ''), NULLIF(trim(qd.config->'documentInfo'->>'salesPerson'), ''), '') quote_sp, qd.name quote_name
       FROM "Document" d
       JOIN LATERAL (SELECT o2."sourceQuotationId" FROM "Order" o2, jsonb_array_elements(COALESCE(o2."linkedDocuments"->'invoice', '[]'::jsonb)) i
                      WHERE o2."organizationId" = d."organizationId" AND i->>'id' = d.id::text AND o2."sourceQuotationId" IS NOT NULL
                        AND upper(COALESCE(o2.status, '')) <> 'CANCELLED' LIMIT 2) o ON true
       JOIN "Document" qd ON qd.id = o."sourceQuotationId"
      WHERE d."organizationId" = $1 AND d.type IN ('INVOICE', 'TI', 'TI2') AND ${EMPTY}${DATED}`,
    [ORG.id]);
  // An invoice listed on two orders with different salespeople is not filled.
  const byInv = new Map();
  for (const r of invs) { const sp = r.quote_sp || filled.get(r.quote) || ''; const cur = byInv.get(r.id) || { ...r, sps: new Set() }; if (sp) cur.sps.add(sp); byInv.set(r.id, cur); }
  let ambiguous = 0;
  const invPlan = [];
  for (const r of byInv.values()) {
    if (r.sps.size > 1) { ambiguous++; continue; }
    if (r.sps.size === 1) invPlan.push({ id: r.id, type: 'INVOICE', name: r.name, after: [...r.sps][0], from: `quotation ${r.quote_name}`, yr: r.yr });
  }
  console.log(`\nstep 2 · invoices with an empty Sales Person whose order's quotation names one: ${invPlan.length}`);
  console.log(`  by person: ${tally(invPlan, (r) => r.after)}`);
  console.log(`  by year:   ${tally(invPlan, (r) => r.yr || '(no date)')}`);
  console.log(`  not filled: ${[...byInv.values()].filter((r) => r.sps.size === 0).length} whose quotation has none either · ${ambiguous} on two orders with different salespeople`);
  const noOrder = (await q(`SELECT count(*)::int n FROM "Document" d WHERE d."organizationId" = $1 AND d.type IN ('INVOICE', 'TI', 'TI2') AND ${EMPTY}`, [ORG.id]))[0].n - byInv.size;
  console.log(`  not on any order (left empty): ${noOrder}`);

  const all = [...plan, ...invPlan];
  console.log(`\nTOTAL to fill: ${all.length} documents (${plan.length} quotations, ${invPlan.length} invoices)`);
  for (const r of all.slice(0, 4)) console.log(`  e.g. ${r.name} → "${r.after}" (${r.from})`);
  if (!APPLY) { console.log('\nDRY RUN: no write. Re-run with --apply.'); await c.end(); return; }
  if (!all.length) { console.log('nothing to do'); await c.end(); return; }

  const stamp = new Date().toISOString();
  const backupFile = path.join(__dirname, `wct-salesperson-from-erp-login.${KEY}.${ENV}.backup-${stamp.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ at: stamp, env: ENV, org: ORG.id, batch: BATCH, rows: all.map((r) => ({ id: r.id, type: r.type, name: r.name, before: '', after: r.after, from: r.from })) }, null, 1));
  console.log(`backup: ${backupFile}`);
  await c.query('BEGIN');
  try {
    let n = 0;
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      // The empty test is repeated in the UPDATE: a field someone filled since the plan was read is not overwritten.
      const r = await c.query(
        `UPDATE "Document" d
            SET config = jsonb_set(jsonb_set(d.config, '{salesPerson}', to_jsonb(v.sp)), '{salesPersonFilled}', jsonb_build_object('from', v.src, 'batch', $4::text, 'at', $5::text))
           FROM (SELECT unnest($1::text[]) id, unnest($2::text[]) sp, unnest($3::text[]) src) v
          WHERE d.id::text = v.id AND d."organizationId" = $6 AND ${EMPTY}`,
        [chunk.map((r) => r.id), chunk.map((r) => r.after), chunk.map((r) => r.from), BATCH, stamp, ORG.id]);
      n += r.rowCount;
    }
    if (n !== all.length) throw new Error(`filled ${n}, planned ${all.length}: something changed in between, nothing was written`);
    await log('UPDATE', `Sales Person filled on ${plan.length} old-ERP quotations (from the login that keyed them) and ${invPlan.length} invoices (from their order's quotation); empty fields only`, { batch: BATCH, backup: path.basename(backupFile) });
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('rolled back, nothing changed');
    throw e;
  }
  fs.writeFileSync(path.join(__dirname, `wct-salesperson-from-erp-login.${KEY}.${ENV}.log.json`), JSON.stringify({ at: stamp, env: ENV, org: ORG.id, batch: BATCH, quotations: plan.length, invoices: invPlan.length, backup: backupFile }, null, 1));
  console.log(`\nAPPLIED: ${plan.length} quotations and ${invPlan.length} invoices filled`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
