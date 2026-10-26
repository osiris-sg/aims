/**
 * WCT — standard-services master list (RevenueItem), from the paper documents
 * guru photographed (Quotation -014162-R0 / Tax Invoice I-015128, the Yoshinoya
 * maintenance job, and Delivery Order DO011982, the Singapore Christian Home
 * job). WCT quotes by PICKING these from the editor's "Add Service" master-file
 * picker (RevenueItemPickerDialog over /revenue-items) — the same
 * select-from-library working style as CIEL's Work Library, in the generic
 * editor (guru 2026-10-26: "use the normal editor, make sure the template
 * follows their look, they can select the services and they're tied to an
 * account"). Every service is tied to WCT's revenue account, so a quotation
 * that becomes an invoice posts each line to that account without the
 * accountant re-coding anything.
 *
 * The recurring "G-" (general) and "S-" (service) lines are $0 scope lines —
 * on the paper they print under the priced maintenance package to spell out
 * what the package covers; the packages carry the real prices.
 *
 *   npx ts-node --transpile-only scripts/setup-wct-services.ts --env dev           # dry run
 *   npx ts-node --transpile-only scripts/setup-wct-services.ts --env dev --apply
 *   npx ts-node --transpile-only scripts/setup-wct-services.ts --env prod --apply  # guru runs with `!`
 *
 * Idempotent: upserts by (org, code) — re-runs refresh name/price/account and
 * never duplicate. Touches ONLY WCT's rows. Services WCT adds later by hand
 * (Master Files → Services) are left alone.
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

// Same fixed id as setup-wct-org.ts (not imported: that script runs its main() on load).
const ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
const ORG_SCHEMA = 'org_wct';
const REVENUE_ACCOUNT = 'SS001'; // Credit Sales — WCT's default 26-account SG chart

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
loadEnv(ENV);
const log = (label: string, msg: string) => console.log(`  ${label.padEnd(10)} ${msg}`);

// Verbatim from the papers. $0 lines are scope lines; packages are priced.
// Codes: G## general, S## service, MA = maintenance agreement. They print in
// this order in the picker (sorted by code), which is the order on the paper.
const SERVICES: Array<{ code: string; name: string; unitPrice: number }> = [
  { code: 'G01', name: 'G- Provide tools, labor and materials to conduct below mentioned services only', unitPrice: 0 },
  {
    code: 'G02',
    name: 'G- Setting up protection coverage for kitchen service area to prevent dust, dirt or chemical to come with contact for any equipments for hygiene purposes',
    unitPrice: 0,
  },
  { code: 'G03', name: 'G- Cutting and opening of access panels on ductworks for service works to be conducted', unitPrice: 0 },
  { code: 'S01', name: 'S- Chemical degreasing for kitchen exhaust hoods (interior and exterior)', unitPrice: 0 },
  { code: 'S02', name: 'S- Chemical degreasing for kitchen grease baffle filters for exhaust hoods', unitPrice: 0 },
  { code: 'S03', name: 'S- Chemical degreasing for exhaust ductworks inside kitchen area to the its provision *where accessible*', unitPrice: 0 },
  { code: 'S04', name: 'S- Chemical degreasing for MV fan/ fan impeller/ fan hub (interior and exterior) *where accessible*', unitPrice: 0 },
  { code: 'S05', name: 'S- Checking, identify, reinforcement for leaking joints with heavy silliant', unitPrice: 0 },
  { code: 'S06', name: 'S- Reinforcement of internal and external ductworks joints after cleaning with heavy type silliant', unitPrice: 0 },
  { code: 'S07', name: 'S- Checking, testing of control panel after service conducted', unitPrice: 0 },
  { code: 'S08', name: 'S- Area cleaning of service work area and clear debris from site', unitPrice: 0 },
  { code: 'S09', name: 'S- Supply and Installation of grease tray/holder for leaking joints', unitPrice: 0 },
  {
    code: 'MA1X',
    name: 'Maintenance agreement of 1 time per year (once per year) package\n*For hood, duct & fan - SGD800 per service*',
    unitPrice: 800,
  },
  {
    code: 'MA3X',
    name: 'Maintenance agreement of 3 times per year (every 4 months per year) package\n*For hood only - SGD350 per service*',
    unitPrice: 350,
  },
];

async function main() {
  console.log(`env=${ENV}  ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const { org, disconnect } = clientsFor(ENV, ORG_SCHEMA);
  try {
    const account = await org.chartOfAccount.findFirst({
      where: { organizationId: ORG_ID, code: REVENUE_ACCOUNT },
      select: { id: true, code: true, name: true },
    });
    if (!account) throw new Error(`WCT has no ${REVENUE_ACCOUNT} account — run setup-wct-org first`);
    log('Account', `${account.code} ${account.name}`);

    let created = 0;
    let updated = 0;
    for (const s of SERVICES) {
      const existing = await org.revenueItem.findFirst({ where: { organizationId: ORG_ID, code: s.code }, select: { id: true } });
      log(s.code, `${existing ? 'update' : 'create'}  $${s.unitPrice.toFixed(2).padStart(7)}  ${s.name.split('\n')[0].slice(0, 80)}`);
      if (existing) updated += 1;
      else created += 1;
      if (!APPLY) continue;
      const data = {
        organizationId: ORG_ID,
        code: s.code,
        name: s.name,
        type: 'SERVICE',
        unitPrice: s.unitPrice,
        accountCode: account.code,
        accountId: account.id,
        isActive: true,
      };
      if (existing) await org.revenueItem.update({ where: { id: existing.id }, data });
      else await org.revenueItem.create({ data });
    }
    console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'} — ${SERVICES.length} services (${created} new, ${updated} refreshed)`);
  } finally {
    await disconnect();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
