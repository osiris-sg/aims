/**
 * Enable the CRM module for every organization (upserts the OrganizationModule
 * row with enabled=true) and make sure every superadmin role with a
 * restrictive allowedModules list includes CRM. Idempotent.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const org of orgs) {
    await prisma.organizationModule.upsert({
      where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: 'CRM' } },
      update: { enabled: true },
      create: {
        organizationId: org.id,
        moduleCode: 'CRM',
        enabled: true,
        displayName: 'CRM',
        icon: 'SupportAgent',
        sortOrder: 14,
        config: {
          route: '/portal/crm',
          subMenus: [
            { key: 'whatsapp', label: 'WhatsApp' },
            { key: 'agent', label: 'AI Agent' },
            { key: 'suggestions', label: 'Suggestions' },
          ],
        },
      },
    });
    console.log(`✅ ${org.name}: CRM enabled`);
  }

  // Superadmin roles with restrictive allowedModules must list CRM to see it.
  const roles = await prisma.role.findMany({
    where: { name: { equals: 'superadmin', mode: 'insensitive' }, NOT: { allowedModules: { isEmpty: true } } },
    select: { id: true, name: true, allowedModules: true, organization: { select: { name: true } } },
  });
  for (const role of roles) {
    if (role.allowedModules.includes('CRM')) continue;
    await prisma.role.update({
      where: { id: role.id },
      data: { allowedModules: [...role.allowedModules, 'CRM'] },
    });
    console.log(`🔄 ${role.organization?.name} / ${role.name}: + CRM in allowedModules`);
  }
  console.log('\n🎉 Done.');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
