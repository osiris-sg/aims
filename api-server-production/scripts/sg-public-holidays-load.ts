/**
 * Singapore public holidays 2026 + 2027 into the Field module's public holidays table (FieldPublicHoliday), for every
 * calendar style org (features.enableCalendarStyle, the WCT group). The jobs calendar shows them as a banner
 * (dashboard/jobs-calendar.service.ts `holidays`). No Field flag is turned on. Dates already in the table for an org
 * are left as they are (one row per org + date). One ActionLog row per org on apply.
 * Source: mom.gov.sg/employment-practices/public-holidays (read 2026-11-24); the Monday after a Sunday holiday is
 * listed there as a public holiday too ("observed").
 * DRY RUN BY DEFAULT.
 *   npx ts-node --transpile-only scripts/sg-public-holidays-load.ts --env prod [--apply --confirm-prod]
 */
import 'dotenv/config';
import { Client } from 'pg';

export const SG_PUBLIC_HOLIDAYS: Array<{ date: string; name: string }> = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year' },
  { date: '2026-02-18', name: 'Chinese New Year' },
  { date: '2026-03-21', name: 'Hari Raya Puasa' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-27', name: 'Hari Raya Haji' },
  { date: '2026-05-31', name: 'Vesak Day' },
  { date: '2026-06-01', name: 'Vesak Day (observed)' },
  { date: '2026-08-09', name: 'National Day' },
  { date: '2026-08-10', name: 'National Day (observed)' },
  { date: '2026-11-08', name: 'Deepavali' },
  { date: '2026-11-09', name: 'Deepavali (observed)' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-02-06', name: 'Chinese New Year' },
  { date: '2027-02-07', name: 'Chinese New Year' },
  { date: '2027-02-08', name: 'Chinese New Year (observed)' },
  { date: '2027-03-10', name: 'Hari Raya Puasa' },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-05-01', name: 'Labour Day' },
  { date: '2027-05-17', name: 'Hari Raya Haji' },
  { date: '2027-05-20', name: 'Vesak Day' },
  { date: '2027-08-09', name: 'National Day' },
  { date: '2027-10-28', name: 'Deepavali' },
  { date: '2027-12-25', name: 'Christmas Day' },
];

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const APPLY = argv.includes('--apply');

async function main() {
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const c = new Client({ connectionString: ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL });
  await c.connect();
  try {
    if (!APPLY) await c.query('SET default_transaction_read_only = on');
    const orgs = (
      await c.query(
        `select o.id::text id, o.name from "Organization" o join "OrganizationUIConfig" u on u."organizationId" = o.id
         where u.features->>'enableCalendarStyle' = 'true' or o.id = '5c700000-0000-4000-8000-5c7000000003' order by o.name`, // + YMM (WCT group, Elroy 2026-11-24)
      )
    ).rows as Array<{ id: string; name: string }>;
    console.log(`${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'}: ${SG_PUBLIC_HOLIDAYS.length} Singapore public holidays (2026 + 2027), ${orgs.length} calendar style org(s)`);
    let total = 0;
    for (const o of orgs) {
      const have = new Set(
        (await c.query(`select date from "FieldPublicHoliday" where "organizationId" = $1 and date between '2026-01-01' and '2027-12-31'`, [o.id])).rows.map((r: any) => r.date),
      );
      const add = SG_PUBLIC_HOLIDAYS.filter((h) => !have.has(h.date));
      total += add.length;
      console.log(`\n${o.name} (${o.id}): ${have.size} already in the table, ${add.length} to insert`);
      for (const h of add) console.log(`  + ${h.date}  ${h.name}`);
      if (APPLY && add.length) {
        await c.query('BEGIN');
        for (const h of add) {
          await c.query(
            `insert into "FieldPublicHoliday"(id, "organizationId", "siteclockId", date, name, "updatedAt") values (gen_random_uuid()::text, $1, null, $2, $3, now())
             on conflict ("organizationId", date) do nothing`,
            [o.id, h.date, h.name],
          );
        }
        await c.query(
          `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
           values (gen_random_uuid()::text, 'SYSTEM', 'sg-public-holidays-load', 'System creation', $1, 'operator', 'CREATE', 'public-holiday', null, $2, 'SUCCESS')`,
          [o.id, JSON.stringify({ note: `Singapore public holidays 2026 + 2027 loaded for the jobs calendar (${add.length} dates)`, dates: add.map((h) => h.date) })],
        );
        await c.query('COMMIT');
        console.log('  written');
      }
    }
    console.log(`\nTotal ${APPLY ? 'inserted' : 'to insert'}: ${total}`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
