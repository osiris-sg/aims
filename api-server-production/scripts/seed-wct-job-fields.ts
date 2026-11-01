/**
 * Custom job fields (2026-11-01, Phase 6): WCT's starting job fields.
 *   Permit required   yes/no · icon "permit"   · calendar: orange when yes
 *   Permit approved   yes/no · icon "verified" · calendar: green when yes, red when no
 *
 *   # dry run (default): prints what would be created / left alone
 *   npx ts-node --transpile-only scripts/seed-wct-job-fields.ts --env dev
 *   DATABASE_URL=<prod url> npx ts-node --transpile-only scripts/seed-wct-job-fields.ts --env prod
 *   # apply (prod also needs --confirm-prod; needs the CustomField.display column, i.e. the deploy)
 *     … --apply [--confirm-prod]
 *
 * Idempotent: a field already there (same technical name) is left as it is; a
 * deactivated one is reported, not revived. The dry run reads only columns prod
 * already has. One ActionLog row per field created. Does NOT turn the
 * enableJobFields flag on.
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
const ORG_SCHEMA = 'org_wct';
const FIELDS = [
  { fieldName: 'permit_required', displayLabel: 'Permit required', fieldType: 'boolean', display: { showOnCalendar: true, icon: 'permit', colourByValue: { true: '#ef6c00' } } },
  { fieldName: 'permit_approved', displayLabel: 'Permit approved', fieldType: 'boolean', display: { showOnCalendar: true, icon: 'verified', colourByValue: { true: '#2e7d32', false: '#c62828' } } },
];

const args = process.argv.slice(2);
const ENV = ((args[args.indexOf('--env') + 1] as Env) || 'dev') as Env;
const APPLY = args.includes('--apply');
if (APPLY && ENV === 'prod' && !args.includes('--confirm-prod')) {
  console.error('Refusing: a prod --apply also needs --confirm-prod');
  process.exit(1);
}
loadEnv(ENV);

(async () => {
  console.log(`env=${ENV}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}  org=WCT  entity=Delivery\n`);
  const { plat, org, disconnect } = clientsFor(ENV, ORG_SCHEMA);
  try {
    const o = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { name: true } });
    if (!o) throw new Error('WCT org not found');
    const existing = await org.customField.findMany({
      where: { organizationId: ORG_ID, entityType: 'Delivery' },
      select: { id: true, fieldName: true, displayLabel: true, isActive: true },
    });
    console.log(`  ${o.name}: ${existing.length} Delivery field(s) today${existing.length ? `: ${existing.map((f: any) => `${f.displayLabel}${f.isActive ? '' : ' (inactive)'}`).join(', ')}` : ''}`);
    let sort = 0;
    for (const f of FIELDS) {
      sort++;
      const have = existing.find((e: any) => e.fieldName === f.fieldName);
      if (have) {
        console.log(`  keep    ${f.displayLabel.padEnd(18)} already there${have.isActive ? '' : ' but INACTIVE (left as is)'}`);
        continue;
      }
      console.log(`  ${APPLY ? 'WRITE ' : 'create'}  ${f.displayLabel.padEnd(18)} yes/no · icon ${f.display.icon} · calendar ${JSON.stringify(f.display.colourByValue)}`);
      if (!APPLY) continue;
      const row = await org.customField.create({
        data: { organizationId: ORG_ID, entityType: 'Delivery', fieldName: f.fieldName, displayLabel: f.displayLabel, fieldType: f.fieldType, required: false, display: f.display, sortOrder: sort, isActive: true, showInForm: true },
        select: { id: true },
      });
      await plat.actionLog
        .create({ data: { organizationId: ORG_ID, actorType: 'SYSTEM', actorId: 'system:seed-wct-job-fields', actorName: 'System creation', channel: 'cron', action: 'CREATE', resource: 'CustomField', resourceId: row.id, details: { fieldName: f.fieldName, label: f.displayLabel } } })
        .catch((e: any) => console.log(`  actionlog not written: ${e?.message}`));
    }
    console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE — nothing written.'}`);
  } finally {
    await disconnect();
  }
})().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
