import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
// Biofuel test users created on prod 2026-06-26 (testkat + testuser), both Admin.
// Replicating BOTH the org membership (UserOrganization — what the auth guard
// checks for org assignment) AND the Admin role (UserRole — permissions).
const TEST_USERS = ['user_3FefJr6LDlOoDfUFycarAzxTfzH', 'user_3FefNFiqFiW3fXwlwhKfKNoOoK1'];
async function main() {
  const adminRole = await p.role.findFirst({
    where: { organizationId: ORG, name: { equals: 'Admin', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!adminRole) throw new Error('Dev Biofuel Admin role not found');

  for (const userId of TEST_USERS) {
    // 1) Org membership (auth guard reads this).
    await p.userOrganization.upsert({
      where: { userId_organizationId: { userId, organizationId: ORG } },
      update: { isActive: true },
      create: { userId, organizationId: ORG, isActive: true },
    });
    // 2) Admin role (permissions).
    await p.userRole.upsert({
      where: { userId_roleId_organizationId: { userId, roleId: adminRole.id, organizationId: ORG } },
      update: { isActive: true },
      create: { userId, roleId: adminRole.id, organizationId: ORG, isActive: true },
    });
    console.log(`✓ ${userId}: membership + "${adminRole.name}" role in Biofuel (dev)`);
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
