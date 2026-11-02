/**
 * WCT worker logins (2026-11-01, Phase 2): every WCT SiteClock WORKER and
 * SUPERVISOR becomes an AIMS WCT field-tech on the Clerk user they already
 * have (they sign in to SiteJobs with their phone + SMS code, like SiteClock).
 *
 *   # dry run (default): prints who would be added / linked / excluded
 *   DATABASE_URL=<prod url> CLERK_SECRET_KEY=<Clerk PRODUCTION key> \
 *     npx ts-node --transpile-only scripts/setup-wct-siteclock-fieldtechs.ts --env prod
 *   # apply (prod also needs --confirm-prod)
 *     … --env prod --apply --confirm-prod
 *
 * Who: Clerk users whose publicMetadata.siteclock.companyId is WCT's SiteClock
 * company (from its SiteClockConnection) and whose role is WORKER or SUPERVISOR.
 * Per user:
 *   - AIMS id = external_id || Clerk id (imported users keep their old id);
 *     external_id is stamped (= own id) ONLY where it is empty. No Clerk user is
 *     ever created, and nothing else on the Clerk user changes.
 *   - someone already in ANOTHER AIMS org is added too (multi-org users,
 *     2026-11-02: they switch org from the top bar) and listed with those orgs;
 *     other SiteClock roles are skipped.
 *   - already a WCT member → roles left alone; only the SiteClock link is stored.
 *   - new → UserOrganization + the field-tech role (WCT only), plus
 *     OrganizationMemberProfile.siteclockUserId so jobs planned on that worker
 *     show under their "My jobs" (enableWctMyJobs).
 *   - one ActionLog row per user written.
 *
 * The dry run only reads, and only columns prod already has. Names are printed
 * (the owner reviews the list); phone numbers and emails are not.
 */
import { createClerkClient } from '@clerk/backend';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
const ORG_SCHEMA = 'org_wct';
const ROLE_NAME = 'field-tech';
const INCLUDED_ROLES = ['WORKER', 'SUPERVISOR'];

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
if (APPLY && ENV === 'prod' && !args.includes('--confirm-prod')) {
  console.error('Refusing: a prod --apply also needs --confirm-prod');
  process.exit(1);
}
loadEnv(ENV);

type Row = { name: string; clerkId: string; aimsId: string; scRole: string; scUserId: string; action: string; note?: string };

async function main() {
  console.log(`env=${ENV}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}  org=WCT  role=${ROLE_NAME}\n`);
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set');
  const clerk = createClerkClient({ secretKey });
  const { plat, org: orgDb, disconnect } = clientsFor(ENV, ORG_SCHEMA);
  try {
    const conn = await plat.siteClockConnection.findUnique({ where: { organizationId: ORG_ID }, select: { siteclockCompanyId: true } });
    if (!conn?.siteclockCompanyId) throw new Error('WCT has no SiteClockConnection');
    const role = await orgDb.role.findFirst({ where: { name: ROLE_NAME, organizationId: ORG_ID }, select: { id: true } });
    if (!role) throw new Error(`role "${ROLE_NAME}" missing on WCT`);
    console.log(`  SiteClock company ${conn.siteclockCompanyId}`);

    // Every Clerk user on that SiteClock company (Clerk can't filter on metadata: page through all).
    const users: any[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await clerk.users.getUserList({ limit: 100, offset });
      users.push(...page.data);
      if (page.data.length < 100) break;
    }
    const company = users.filter((u) => (u.publicMetadata as any)?.siteclock?.companyId === conn.siteclockCompanyId);
    console.log(`  ${users.length} Clerk users, ${company.length} on WCT's SiteClock company\n`);

    const rows: Row[] = [];
    for (const u of company) {
      const sc = (u.publicMetadata as any).siteclock || {};
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id;
      const aimsId = u.externalId || u.id;
      const base = { name, clerkId: u.id, aimsId, scRole: String(sc.role || ''), scUserId: String(sc.userId || '') };
      if (!INCLUDED_ROLES.includes(base.scRole)) {
        rows.push({ ...base, action: 'skip', note: `SiteClock role ${base.scRole || 'none'} (only workers and supervisors)` });
        continue;
      }
      if (!base.scUserId) {
        rows.push({ ...base, action: 'skip', note: 'no SiteClock user id in Clerk metadata' });
        continue;
      }
      const memberships = await plat.userOrganization.findMany({ where: { userId: aimsId, isActive: true }, select: { organizationId: true } });
      const others = memberships.filter((m: any) => m.organizationId !== ORG_ID);
      const orgNames = others.length ? await plat.organization.findMany({ where: { id: { in: others.map((m: any) => m.organizationId) } }, select: { name: true } }) : [];
      const alsoIn = orgNames.length ? `; also in ${orgNames.map((o: any) => o.name).join(', ')} (keeps that membership)` : '';
      const inWct = memberships.some((m: any) => m.organizationId === ORG_ID);
      rows.push({ ...base, action: inWct ? 'link' : 'add', note: (inWct ? 'already a WCT member: roles left alone, SiteClock link stored' : !u.externalId ? 'external_id stamped = own id' : 'imported user (keeps its AIMS id)') + alsoIn });
    }

    const order = ['add', 'link', 'skip'];
    rows.sort((a, b) => order.indexOf(a.action) - order.indexOf(b.action) || a.name.localeCompare(b.name));
    for (const r of rows) console.log(`  ${r.action.padEnd(8)} ${r.scRole.padEnd(13)} ${r.name.padEnd(28)} ${r.note ?? ''}`);
    const count = (a: string) => rows.filter((r) => r.action === a).length;
    console.log(`\n  add ${count('add')} · link ${count('link')} · skip ${count('skip')}`);

    if (!APPLY) {
      console.log('\nDRY RUN DONE — nothing written. Re-run with --apply (prod: --apply --confirm-prod).');
      return;
    }
    for (const r of rows.filter((x) => x.action === 'add' || x.action === 'link')) {
      const u = company.find((x) => x.id === r.clerkId)!;
      if (!u.externalId) {
        await clerk.users.updateUser(u.id, { externalId: u.id });
        console.log(`  WRITE clerk external_id ${r.name}`);
      }
      if (r.action === 'add') {
        await plat.userOrganization.upsert({
          where: { userId_organizationId: { userId: r.aimsId, organizationId: ORG_ID } },
          update: { isActive: true },
          create: { userId: r.aimsId, organizationId: ORG_ID, isActive: true },
        });
        await orgDb.userRole.upsert({
          where: { userId_roleId_organizationId: { userId: r.aimsId, roleId: role.id, organizationId: ORG_ID } },
          update: { isActive: true },
          create: { userId: r.aimsId, roleId: role.id, organizationId: ORG_ID, isActive: true },
        });
        console.log(`  WRITE membership + ${ROLE_NAME} ${r.name}`);
      }
      await plat.organizationMemberProfile.upsert({
        where: { organizationId_userId: { organizationId: ORG_ID, userId: r.aimsId } },
        update: { siteclockUserId: r.scUserId },
        create: { organizationId: ORG_ID, userId: r.aimsId, siteclockUserId: r.scUserId },
      });
      console.log(`  WRITE siteclock link ${r.name}`);
      await plat.actionLog
        .create({
          data: {
            organizationId: ORG_ID,
            actorType: 'SYSTEM',
            actorId: 'system:setup-wct-siteclock-fieldtechs',
            actorName: 'System creation',
            channel: 'cron',
            action: r.action === 'add' ? 'CREATE' : 'UPDATE',
            resource: 'UserRole',
            resourceId: r.aimsId,
            details: { role: r.action === 'add' ? ROLE_NAME : null, siteclockUserId: r.scUserId, siteclockRole: r.scRole },
          },
        })
        .catch((e: any) => console.log(`  actionlog not written: ${e?.message}`));
    }
    console.log('\nDONE');
  } finally {
    await disconnect();
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
