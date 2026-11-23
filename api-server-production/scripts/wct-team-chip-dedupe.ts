/**
 * WCT group (calendar style orgs): jobs whose stored "Team / crew" repeats a name (2026-11-24 chip bug). A pick twice
 * (same id, or same kind and name, any case), a piece of free text twice (any case), or free text equal to a pick's
 * name. Cleaned with the app's own rule (deliveries/job-style.ts dedupeCrewTeam); text is kept as typed.
 * Only `team` and `crew` of the stored value change. One ActionLog row per job on apply.
 * DRY RUN BY DEFAULT.
 *   npx ts-node --transpile-only scripts/wct-team-chip-dedupe.ts --env prod [--apply --confirm-prod]
 */
import 'dotenv/config';
import { Client } from 'pg';
import { crewOf, dedupeCrewTeam, teamOf } from '../src/deliveries/job-style';

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const APPLY = argv.includes('--apply');

const shown = (crew: Array<{ name: string }>, team: string | null) => [...crew.map((c) => c.name), team ?? ''].filter(Boolean).join(' + ') || '(empty)';

async function main() {
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const c = new Client({ connectionString: ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL });
  await c.connect();
  try {
    if (!APPLY) await c.query('SET default_transaction_read_only = on');
    const rows = (
      await c.query(
        `select v."customFieldId" fid, v."entityId" job, v.value, cf."organizationId"::text org, o.name "orgName", d."deliveryNumber" no
         from "CustomFieldValue" v
         join "CustomField" cf on cf.id = v."customFieldId" and cf."fieldName" = 'job_calendar_style'
         join "OrganizationUIConfig" u on u."organizationId" = cf."organizationId" and u.features->>'enableCalendarStyle' = 'true'
         join "Organization" o on o.id = cf."organizationId"
         left join "Delivery" d on d.id::text = v."entityId"::text
         where coalesce(v.value->>'team', '') <> '' or jsonb_array_length(case when jsonb_typeof(v.value->'crew') = 'array' then v.value->'crew' else '[]'::jsonb end) > 0`,
      )
    ).rows;
    const fixes: Array<{ r: any; before: string; after: string; next: any }> = [];
    for (const r of rows) {
      const raw = r.value && typeof r.value === 'object' ? r.value : {};
      const crew = crewOf(raw.crew);
      const team = teamOf(raw.team);
      const d = dedupeCrewTeam(crew, team);
      // Same-id repeats are already dropped by crewOf, so compare with the stored list itself.
      const same = d.team === team && d.crew.length === (Array.isArray(raw.crew) ? raw.crew.length : 0);
      if (same) continue;
      fixes.push({ r, before: shown(crew, team), after: shown(d.crew, d.team), next: { ...raw, crew: d.crew, team: d.team } });
    }
    console.log(`${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} WCT group job(s) with a Team / crew, ${fixes.length} with duplicate chips`);
    for (const f of fixes.slice(0, 10)) console.log(`  #${f.r.no ?? '?'} (${f.r.orgName}): ${f.before} -> ${f.after}`);
    if (fixes.length > 10) console.log(`  ... and ${fixes.length - 10} more`);
    if (APPLY) {
      for (const f of fixes) {
        await c.query('BEGIN');
        await c.query(`update "CustomFieldValue" set value = $3::jsonb where "customFieldId" = $1 and "entityId" = $2`, [f.r.fid, f.r.job, JSON.stringify(f.next)]);
        await c.query(
          `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
           values (gen_random_uuid()::text, 'SYSTEM', 'wct-team-chip-dedupe', 'System creation', $1, 'operator', 'UPDATE', 'delivery', $2, $3, 'SUCCESS')`,
          [f.r.org, String(f.r.job), JSON.stringify({ note: `Team / crew duplicates removed: ${f.before} -> ${f.after}` })],
        );
        await c.query('COMMIT');
      }
      console.log(`written: ${fixes.length}`);
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
