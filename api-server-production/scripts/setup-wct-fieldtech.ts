/**
 * WCT field-tech login — a USERNAME account (like fieldtech_biofuel2) that is
 * attached to WCT with ONLY the field-tech role, so FieldOnlyGuard locks it
 * into the field app (/scan) and it sees the field-tech view, not the office
 * portal.
 *
 *   npx ts-node --transpile-only scripts/setup-wct-fieldtech.ts --env dev            # dry run
 *   npx ts-node --transpile-only scripts/setup-wct-fieldtech.ts --env dev --apply
 *   npx ts-node --transpile-only scripts/setup-wct-fieldtech.ts --env prod --apply   # guru runs with `!`
 *
 * Username defaults to sitejob_wct; override with --username <name>.
 * A temporary password is generated and PRINTED once on --apply — share it
 * securely; the tech changes it after first sign-in. Idempotent: an existing
 * Clerk user with that username is reused (password unchanged) and just
 * (re)attached to WCT as field-tech.
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
const USERNAME = argVal('--username', 'sitejob_wct') as string;
// Optional fixed password (e.g. --password password for testing). When set,
// Clerk's strength / breach check is skipped so a weak one is accepted.
const CUSTOM_PASSWORD = argVal('--password');
loadEnv(ENV);

// 16 chars, mixed case + digits + symbol — easy to type once (same shape as
// scripts/create-field-tech-user.ts).
const genPassword = () => `Fld!${randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 12)}`;

async function main() {
  console.log(`env=${ENV}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}  username=${USERNAME}  org=WCT ${ORG_ID}\n`);
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set in the loaded env');
  const clerk = createClerkClient({ secretKey, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });

  // Organization + UserOrganization are platform-level; Role + UserRole are
  // org-level. On prod (public layout) plat and org are the same client.
  const { plat, org: orgDb, disconnect } = clientsFor(ENV, ORG_SCHEMA);
  try {
    const org = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { id: true, name: true } });
    if (!org) throw new Error('WCT org not found — run setup-wct-org.ts first');
    const role = await orgDb.role.findFirst({ where: { name: 'field-tech', organizationId: ORG_ID }, select: { id: true } });
    if (!role) throw new Error('field-tech role missing on WCT — run setup-wct-org.ts first');
    console.log(`  org        ${org.name}`);
    console.log(`  role       field-tech (${role.id}) — FieldOnlyGuard locks this user to /scan`);

    // Find existing Clerk user by username (idempotent).
    const existing = await clerk.users.getUserList({ username: [USERNAME] }).catch(() => ({ data: [] as any[] }));
    let clerkUser = existing.data[0];
    let tempPassword: string | null = null;

    if (clerkUser) {
      // Existing user: set the custom password if one was asked for, else leave it.
      if (CUSTOM_PASSWORD && APPLY) {
        await clerk.users.updateUser(clerkUser.id, { password: CUSTOM_PASSWORD, skipPasswordChecks: true });
        tempPassword = CUSTOM_PASSWORD;
        console.log(`  clerk      exists ${clerkUser.id} — password reset to the one provided`);
      } else {
        console.log(`  clerk      exists ${clerkUser.id} (password unchanged)`);
      }
    } else if (!APPLY) {
      console.log(`  clerk      would CREATE username "${USERNAME}" with ${CUSTOM_PASSWORD ? 'the provided password' : 'a generated password'}`);
    } else {
      tempPassword = CUSTOM_PASSWORD || genPassword();
      clerkUser = await clerk.users.createUser({ username: USERNAME, password: tempPassword, skipPasswordChecks: !!CUSTOM_PASSWORD, skipPasswordRequirement: false });
      console.log(`  clerk      created ${clerkUser.id}`);
    }

    const userId = clerkUser?.id;
    console.log(`  membership ${APPLY ? 'upsert' : 'would upsert'} UserOrganization + field-tech UserRole (only this role)`);
    if (APPLY && userId) {
      await plat.userOrganization.upsert({
        where: { userId_organizationId: { userId, organizationId: ORG_ID } },
        update: { isActive: true },
        create: { userId, organizationId: ORG_ID, isActive: true },
      });
      // Field-tech ONLY: strip any other role so FieldOnlyGuard applies.
      await orgDb.userRole.deleteMany({ where: { userId, organizationId: ORG_ID, roleId: { not: role.id } } });
      await orgDb.userRole.upsert({
        where: { userId_roleId_organizationId: { userId, roleId: role.id, organizationId: ORG_ID } },
        update: { isActive: true },
        create: { userId, roleId: role.id, organizationId: ORG_ID, isActive: true },
      });
    }

    console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE — re-run with --apply to create.'}`);
    if (APPLY) {
      console.log(`\n  Username:  ${USERNAME}`);
      if (tempPassword) {
        console.log(`  Password:  ${tempPassword}`);
        console.log('  ⚠️  Share securely; the tech changes it after first sign-in.');
      } else {
        console.log('  Password:  (unchanged — user already existed in Clerk)');
      }
      console.log('  Login:     the field app sign-in with this username + password.');
    }
  } finally {
    await disconnect();
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
