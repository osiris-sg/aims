/**
 * WCT login creator — a Clerk user attached to WCT with a chosen role.
 *
 * Defaults make a field-tech USERNAME account (sitejob_wct, like
 * fieldtech_biofuel2): field-tech only, so FieldOnlyGuard locks it into the
 * field app (/scan). With --role Admin (or Manager/User/superadmin) and
 * --email it instead makes an office account that signs into the portal.
 *
 *   # field-tech (default)
 *   npx ts-node --transpile-only scripts/setup-wct-fieldtech.ts --env prod --apply
 *
 *   # WCT Admin test login by email
 *   npx ts-node --transpile-only scripts/setup-wct-fieldtech.ts --env prod --apply \
 *       --role Admin --email wctadmin@osiris.sg --password password
 *
 * Flags: --env dev|prod, --apply (dry run otherwise), --role <name>
 * (default field-tech), --username <name> OR --email <addr> (the login id),
 * --password <pw> (else a strong one is generated and printed). Idempotent: an
 * existing Clerk user is reused; --password resets it. Only the field-tech
 * role is made exclusive (other roles are stripped); any other role is added
 * without removing existing ones. guru runs the prod --apply with `!`.
 */
import { createClerkClient } from '@clerk/backend';
import { randomBytes } from 'crypto';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
const ORG_SCHEMA = 'org_wct';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
const ROLE_NAME = argVal('--role', 'field-tech') as string;
const EMAIL = argVal('--email');
const USERNAME = EMAIL ? undefined : (argVal('--username', 'sitejob_wct') as string);
const LOGIN_ID = EMAIL || USERNAME!;
// Optional fixed password (e.g. --password password for testing). When set,
// Clerk's strength / breach check is skipped so a weak one is accepted.
const CUSTOM_PASSWORD = argVal('--password');
loadEnv(ENV);

const genPassword = () => `Wct!${randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 12)}`;

async function main() {
  console.log(`env=${ENV}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}  ${EMAIL ? 'email' : 'username'}=${LOGIN_ID}  role=${ROLE_NAME}  org=WCT\n`);
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set in the loaded env');
  const clerk = createClerkClient({ secretKey, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });

  // Organization + UserOrganization are platform-level; Role + UserRole are
  // org-level. On prod (public layout) plat and org are the same client.
  const { plat, org: orgDb, disconnect } = clientsFor(ENV, ORG_SCHEMA);
  const isFieldTech = ROLE_NAME === 'field-tech';
  try {
    const org = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { id: true, name: true } });
    if (!org) throw new Error('WCT org not found — run setup-wct-org.ts first');
    const role = await orgDb.role.findFirst({ where: { name: ROLE_NAME, organizationId: ORG_ID }, select: { id: true } });
    if (!role) throw new Error(`role "${ROLE_NAME}" missing on WCT — run setup-wct-org.ts first`);
    console.log(`  org        ${org.name}`);
    console.log(`  role       ${ROLE_NAME} (${role.id})${isFieldTech ? ' — FieldOnlyGuard locks this user to /scan' : ''}`);

    // Find existing Clerk user by the chosen identifier (idempotent).
    const existing = EMAIL
      ? await clerk.users.getUserList({ emailAddress: [EMAIL] }).catch(() => ({ data: [] as any[] }))
      : await clerk.users.getUserList({ username: [USERNAME!] }).catch(() => ({ data: [] as any[] }));
    let clerkUser = existing.data[0];
    let password: string | null = null;

    if (clerkUser) {
      if (CUSTOM_PASSWORD && APPLY) {
        await clerk.users.updateUser(clerkUser.id, { password: CUSTOM_PASSWORD, skipPasswordChecks: true });
        password = CUSTOM_PASSWORD;
        console.log(`  clerk      exists ${clerkUser.id} — password reset`);
      } else {
        console.log(`  clerk      exists ${clerkUser.id} (password unchanged)`);
      }
    } else if (!APPLY) {
      console.log(`  clerk      would CREATE ${LOGIN_ID} with ${CUSTOM_PASSWORD ? 'the provided password' : 'a generated password'}`);
    } else {
      password = CUSTOM_PASSWORD || genPassword();
      clerkUser = await clerk.users.createUser({
        ...(EMAIL ? { emailAddress: [EMAIL] } : { username: USERNAME! }),
        password,
        skipPasswordChecks: !!CUSTOM_PASSWORD,
        skipPasswordRequirement: false,
      });
      console.log(`  clerk      created ${clerkUser.id}`);
    }

    const userId = clerkUser?.id;
    console.log(`  membership ${APPLY ? 'upsert' : 'would upsert'} UserOrganization + ${ROLE_NAME} UserRole${isFieldTech ? ' (only this role)' : ''}`);
    if (APPLY && userId) {
      await plat.userOrganization.upsert({
        where: { userId_organizationId: { userId, organizationId: ORG_ID } },
        update: { isActive: true },
        create: { userId, organizationId: ORG_ID, isActive: true },
      });
      // Only field-tech is exclusive (for FieldOnlyGuard); other roles are additive.
      if (isFieldTech) {
        await orgDb.userRole.deleteMany({ where: { userId, organizationId: ORG_ID, roleId: { not: role.id } } });
      }
      await orgDb.userRole.upsert({
        where: { userId_roleId_organizationId: { userId, roleId: role.id, organizationId: ORG_ID } },
        update: { isActive: true },
        create: { userId, roleId: role.id, organizationId: ORG_ID, isActive: true },
      });
    }

    console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE — re-run with --apply to create.'}`);
    if (APPLY) {
      console.log(`\n  Login id:  ${LOGIN_ID}`);
      console.log(password ? `  Password:  ${password}` : '  Password:  (unchanged — user already existed in Clerk)');
      console.log(`  Signs in:  ${isFieldTech ? 'the field app (/scan), scoped to WCT' : 'the portal with the ' + ROLE_NAME + ' role on WCT'}`);
    }
  } finally {
    await disconnect();
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
