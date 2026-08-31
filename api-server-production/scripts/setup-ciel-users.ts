/**
 * CIEL INTERIOR user accounts: Mike Leong and Levi Choo (the two owners).
 * Creates each in Clerk once (dev/staging/prod share the instance) and, in the
 * CURRENT env's DB, gives them BOTH roles on the CIEL org — Management (full
 * access) and Designer (so they appear in the designer dropdowns and the
 * WhatsApp agent can route to them) — plus their WhatsApp number on the
 * per-org member profile.
 *
 * Idempotent. Run per env:
 *   npx ts-node scripts/setup-ciel-users.ts                       (dev)
 *   npx dotenv -e .env.staging -- npx ts-node scripts/setup-ciel-users.ts
 *   npx dotenv -e .env.production -- npx ts-node scripts/setup-ciel-users.ts
 */
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const ORG_NAME = 'CIEL INTERIOR PTE. LTD.';

const USERS = [
  { email: 'mikeleong@cielinterior.com', firstName: 'Mike', lastName: 'Leong', whatsapp: '6582289608' },
  { email: 'levichoo@cielinterior.com', firstName: 'Levi', lastName: 'Choo', whatsapp: '6583686614' },
  { email: 'summerec@cielinterior.com', firstName: 'Summer', lastName: 'EC', whatsapp: '6587640168' },
];

async function main() {
  const org = await prisma.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (!org) throw new Error(`${ORG_NAME} not found in this DB`);
  const roles = await prisma.role.findMany({ where: { organizationId: org.id, name: { in: ['Management', 'Designer'] } }, select: { id: true, name: true } });
  if (roles.length !== 2) throw new Error(`Expected Management + Designer roles on CIEL, found: ${roles.map((r) => r.name).join(', ') || 'none'}`);

  for (const u of USERS) {
    // 1. Clerk: find by email, create if missing (shared instance → same id everywhere).
    let clerkUser = (await clerk.users.getUserList({ emailAddress: [u.email] })).data?.[0];
    let password: string | null = null;
    if (!clerkUser) {
      password = `Ciel-${randomBytes(6).toString('base64url')}`;
      clerkUser = await clerk.users.createUser({
        firstName: u.firstName,
        lastName: u.lastName,
        emailAddress: [u.email],
        password,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      });
      console.log(`🆕 Clerk user created: ${u.email} [${clerkUser.id}]  TEMP PASSWORD: ${password}`);
    } else {
      console.log(`   Clerk user exists: ${u.email} [${clerkUser.id}]`);
    }

    // 2. Org membership + both roles (membership needs BOTH tables).
    await prisma.userOrganization.upsert({
      where: { userId_organizationId: { userId: clerkUser.id, organizationId: org.id } },
      update: { isActive: true },
      create: { userId: clerkUser.id, organizationId: org.id, isActive: true },
    });
    for (const role of roles) {
      await prisma.userRole.upsert({
        where: { userId_roleId_organizationId: { userId: clerkUser.id, roleId: role.id, organizationId: org.id } },
        update: { isActive: true },
        create: { userId: clerkUser.id, roleId: role.id, organizationId: org.id, isActive: true },
      });
    }

    // 3. Member profile: WhatsApp number for agent routing (commission left at org default).
    await prisma.organizationMemberProfile.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: clerkUser.id } },
      update: { whatsappNumber: u.whatsapp },
      create: { organizationId: org.id, userId: clerkUser.id, whatsappNumber: u.whatsapp },
    });
    console.log(`   ✅ ${u.firstName} ${u.lastName} → Management + Designer on CIEL, WhatsApp ${u.whatsapp}`);
  }
  console.log(`\n🎉 Done for org ${org.id}`);
}

main()
  .catch((e) => {
    console.error('❌', e?.errors?.[0]?.message || e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
