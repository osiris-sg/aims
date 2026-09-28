/**
 * Eugene account (guru 2026-09-26): eugene@biofuelindustries.sg as Admin on
 * "Biofuel Industries Pte Ltd". Creates the Clerk user once (all envs share the
 * instance) and, in the CURRENT env's DB, the UserOrganization + UserRole(Admin)
 * rows (membership needs BOTH tables).
 *
 * Idempotent. Run per env:
 *   npx ts-node scripts/setup-eugene-user.ts                        (dev)
 *   npx dotenv -e .env.production -- npx ts-node scripts/setup-eugene-user.ts
 */
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const ORG_NAME = 'Biofuel Industries Pte Ltd';
const EMAIL = 'eugene@biofuelindustries.sg';
const FIRST = 'Eugene';
// Interim password chosen by guru. It is 6 characters, so it fails Clerk's
// length and breach checks — skipped explicitly, as for the Richie account.
// Eugene should change it after first login.
const PASSWORD = '369369';

async function main() {
  const org = await prisma.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (!org) throw new Error(`${ORG_NAME} not found in this DB`);
  const role = await prisma.role.findFirst({ where: { organizationId: org.id, name: 'Admin' }, select: { id: true } });
  if (!role) throw new Error(`Admin role not found on ${ORG_NAME}`);

  let clerkUser = (await clerk.users.getUserList({ emailAddress: [EMAIL] })).data?.[0];
  if (!clerkUser) {
    clerkUser = await clerk.users.createUser({
      firstName: FIRST,
      emailAddress: [EMAIL],
      password: PASSWORD,
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
    });
    console.log(`🆕 Clerk user created: ${EMAIL} [${clerkUser.id}]`);
  } else {
    console.log(`   Clerk user already existed: ${EMAIL} [${clerkUser.id}]`);
  }

  await prisma.userOrganization.upsert({
    where: { userId_organizationId: { userId: clerkUser.id, organizationId: org.id } },
    update: { isActive: true },
    create: { userId: clerkUser.id, organizationId: org.id, isActive: true },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId_organizationId: { userId: clerkUser.id, roleId: role.id, organizationId: org.id } },
    update: { isActive: true },
    create: { userId: clerkUser.id, roleId: role.id, organizationId: org.id, isActive: true },
  });
  console.log(`✅ ${FIRST} → Admin on ${ORG_NAME} (org ${org.id})`);
}

main()
  .catch((e) => {
    console.error('❌', e?.errors?.[0]?.message || e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
