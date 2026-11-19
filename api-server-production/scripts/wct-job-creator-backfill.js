// Jobs calendar "Created by" backfill (WCT round 36, Elroy 2026-11-20): jobs made before the creator was recorded
// (19 Nov 2026) read "Unknown". This finds who made each one, from (in order):
//   1. the Activity Log: a person's POST to a jobs / orders route in the job's org within 20 s of the job's creation (closest wins; two
//      different people equally close = ambiguous, left Unknown);
//   2. the job's order: a person's POST within 20 s of the order's creation;
//   3. the job's DO: the person who created it (document history, AuditLog CREATED).
// Jobs with none stay Unknown (the side panel hides "Created by" for them). Only an EMPTY creator is filled; never
// overwritten. WCT group orgs only (WCT (S), Racking, YMM, BC Air); drafts left out.
// Dry run by default (prints every job, its proposed creator and the source; writes the list to
// ~/Desktop/aims-agents/imports/wct-r36-job-creators.<env>.txt). --apply writes in one transaction: the creator
// into the job's calendar style value (CustomField 'job_calendar_style', made when missing), one ActionLog
// "System creation" row per job, and a local log json.
//   node scripts/wct-job-creator-backfill.js                         dry run on dev
//   node scripts/wct-job-creator-backfill.js --env prod              dry run on prod
//   node scripts/wct-job-creator-backfill.js --env prod --apply --confirm-prod   (Elroy's go only)
// dev = DATABASE_URL, platform schema; prod = PROD_DATABASE_URL, public schema. URLs never printed.
process.env.TZ = 'UTC'; // node-pg reads Prisma's naive timestamps as local time: UTC keeps them right
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GROUP = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'WCT Racking',
  '5c700000-0000-4000-8000-5c7000000003': 'YMM',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const FIELD = 'job_calendar_style';
const WINDOW_S = 20;
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : '');
const ENV = arg('--env') || 'dev';
if (!['prod', 'dev'].includes(ENV)) throw new Error('--env must be prod or dev');
const URL_VAR = ENV === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
const S = ENV === 'prod' ? '"public"' : '"platform"';
const APPLY = process.argv.includes('--apply');
if (APPLY && ENV === 'prod' && !process.argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod (Elroy\'s go)');

/** The closest person in a list of { actorId, actorName, secs } (null when none, 'ambiguous' when two people tie). */
function closest(rows) {
  const people = rows.filter((r) => r.actorId);
  if (!people.length) return null;
  people.sort((a, b) => a.secs - b.secs);
  const best = people[0];
  const tie = people.find((r) => r.actorId !== best.actorId && Math.abs(r.secs - best.secs) < 2);
  return tie ? 'ambiguous' : best;
}

(async () => {
  if (!process.env[URL_VAR]) throw new Error(`${URL_VAR} is not set`);
  console.log(`env: ${ENV}${APPLY ? '' : ' (dry run)'}`);
  const c = new Client({ connectionString: process.env[URL_VAR] });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const orgIds = Object.keys(GROUP);

  // Jobs with no creator yet (no style value, or one without createdById).
  const jobs = await q(
    `select d.id::text id, d."organizationId"::text org, d."deliveryNumber" no, d."createdAt" at, d."orderId"::text "orderId", d.status,
            f.id::text "fieldId", v.id::text "valueId", v.value
       from ${S}."Delivery" d
       left join ${S}."CustomField" f on f."organizationId" = d."organizationId" and f."entityType" = 'Delivery' and f."fieldName" = $2
       left join ${S}."CustomFieldValue" v on v."customFieldId" = f.id and v."entityId" = d.id::text
      where d."organizationId"::text = any($1::text[]) and d."isDraft" = false
        and coalesce(v.value->>'createdById', '') = ''
      order by d."organizationId", d."deliveryNumber"`,
    [orgIds, FIELD],
  );
  const plan = [];
  const unknown = [];
  const lines = [];
  for (const j of jobs) {
    let pick = null;
    let source = '';
    // 1. The Activity Log around the job's creation.
    const near = await q(
      `select a."actorId", a."actorName", a.path, abs(extract(epoch from (a."createdAt" - $2::timestamp))) secs
         from ${S}."ActionLog" a
        where a."organizationId" = $1 and a."actorType" = 'USER' and a.method = 'POST' and a.status = 'SUCCESS'
          and (a.path ilike '%/deliveries%' or a.path ilike '%/orders/%')
          and a."createdAt" between $2::timestamp - interval '${WINDOW_S} seconds' and $2::timestamp + interval '${WINDOW_S} seconds'`,
      [j.org, j.at],
    );
    const a = closest(near.map((r) => ({ ...r, secs: Number(r.secs) })));
    if (a === 'ambiguous') source = 'ambiguous (two people at the same moment)';
    else if (a) {
      pick = { id: a.actorId, name: a.actorName };
      source = `activity log: ${a.path} (${Math.round(a.secs)} s)`;
    }
    // 2. The order's creation.
    if (!pick && !source && j.orderId) {
      const [o] = await q(`select "createdAt" at from ${S}."Order" where id::text = $1`, [j.orderId]);
      if (o) {
        const nearO = await q(
          `select a."actorId", a."actorName", a.path, abs(extract(epoch from (a."createdAt" - $2::timestamp))) secs
             from ${S}."ActionLog" a
            where a."organizationId" = $1 and a."actorType" = 'USER' and a.method = 'POST' and a.status = 'SUCCESS'
              and (a.path ilike '%/orders%' or a.path ilike '%/documents%' or a.path ilike '%quotation%')
              and a."createdAt" between $2::timestamp - interval '${WINDOW_S} seconds' and $2::timestamp + interval '${WINDOW_S} seconds'`,
          [j.org, o.at],
        );
        const b = closest(nearO.map((r) => ({ ...r, secs: Number(r.secs) })));
        if (b && b !== 'ambiguous') {
          pick = { id: b.actorId, name: b.actorName };
          source = `order creator: ${b.path}`;
        }
      }
    }
    // 3. The job's DO creator (document history).
    if (!pick && !source) {
      const [d] = await q(
        `select l."userId", l."userName", doc.name
           from ${S}."DeliveryItem" i
           join ${S}."Document" doc on doc.id = i."documentId"
           join ${S}."AuditLog" l on l."resourceId" = doc.id::text and l.resource = 'document' and l.action = 'CREATED'
          where i."deliveryId"::text = $1 and l."userId" <> 'system'
          order by l."createdAt" asc limit 1`,
        [j.id],
      );
      if (d) {
        pick = { id: d.userId, name: d.userName };
        source = `DO creator: ${d.name}`;
      }
    }
    const line = `${GROUP[j.org]} job #${j.no} (${j.status}, made ${new Date(j.at).toISOString().slice(0, 16)}): ${pick ? `${pick.name || pick.id} [${source}]` : `Unknown${source ? ` [${source}]` : ''}`}`;
    lines.push(line);
    console.log(line);
    if (pick) plan.push({ ...j, pick, source });
    else unknown.push(j);
  }
  const bySource = {};
  for (const p of plan) {
    const k = p.source.split(':')[0];
    bySource[k] = (bySource[k] || 0) + 1;
  }
  const summary = `jobs without a creator: ${jobs.length}; found: ${plan.length} (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}); still unknown: ${unknown.length}`;
  console.log(summary);
  const out = path.join(os.homedir(), 'Desktop/aims-agents/imports', `wct-r36-job-creators.${ENV}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, [`Created by backfill, ${ENV}, ${new Date().toISOString()}${APPLY ? ' (APPLY)' : ' (dry run)'}`, summary, '', ...lines, ''].join('\n'));
  console.log(`list: ${out}`);
  if (!plan.length || !APPLY) {
    if (!APPLY) console.log(`DRY RUN: ${plan.length} change(s), no write. Re-run with --apply${ENV === 'prod' ? ' --confirm-prod' : ''}.`);
    await c.end();
    return;
  }

  await c.query('begin');
  const fieldOf = new Map();
  for (const p of plan) {
    let fieldId = p.fieldId || fieldOf.get(p.org);
    if (!fieldId) {
      const [f] = await q(
        `insert into ${S}."CustomField"(id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, "isActive", "showInList", "showInForm", "sortOrder", "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, 'Delivery', $2, 'Calendar style', 'json', false, false, false, false, 0, now(), now())
         on conflict ("organizationId", "entityType", "fieldName") do update set "updatedAt" = ${S}."CustomField"."updatedAt"
         returning id::text id`,
        [p.org, FIELD],
      );
      fieldId = f.id;
      fieldOf.set(p.org, fieldId);
    }
    // Fill only an empty creator (re-checked in the write).
    const res = await c.query(
      `insert into ${S}."CustomFieldValue"(id, "customFieldId", "entityId", "entityType", value, "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, 'Delivery', jsonb_build_object('createdById', $3::text), now(), now())
       on conflict ("customFieldId", "entityId") do update
         set value = ${S}."CustomFieldValue".value || jsonb_build_object('createdById', $3::text), "updatedAt" = now()
         where coalesce(${S}."CustomFieldValue".value->>'createdById', '') = ''`,
      [fieldId, p.id, p.pick.id],
    );
    if (!res.rowCount) continue;
    await c.query(
      `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-job-creator-backfill', 'System creation', $1, 'operator', 'UPDATE', 'deliveries', $2, $3, 'SUCCESS')`,
      [p.org, p.id, JSON.stringify({ note: `Created by backfill: job #${p.no} = ${p.pick.name || p.pick.id} (${p.source})` })],
    );
  }
  await c.query('commit');
  const log = path.join(__dirname, `wct-job-creator-backfill.${ENV}.${new Date().toISOString().replace(/[:.]/g, '-')}.log.json`);
  fs.writeFileSync(log, JSON.stringify({ at: new Date().toISOString(), env: ENV, changed: plan.map((p) => ({ org: p.org, job: p.id, no: p.no, createdById: p.pick.id, name: p.pick.name, source: p.source })) }, null, 2));
  console.log(`APPLIED: ${plan.length} job(s); log ${log}`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
