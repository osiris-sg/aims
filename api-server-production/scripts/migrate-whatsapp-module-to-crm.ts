/**
 * WHATSAPP module → CRM rename (2026-07-19). The WhatsApp pages moved under
 * the new CRM sidebar module. This migrates per-org state:
 *   1. OrganizationModule rows: moduleCode WHATSAPP → CRM (keeps enabled flag;
 *      orphan WHATSAPP rows would otherwise still render via the catalog merge).
 *   2. Role.allowedModules lists: WHATSAPP → CRM.
 * Idempotent — safe to re-run.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.organizationModule.findMany({ where: { moduleCode: 'WHATSAPP' } });
  for (const row of rows) {
    const existingCrm = await prisma.organizationModule.findFirst({
      where: { organizationId: row.organizationId, moduleCode: 'CRM' },
    });
    if (existingCrm) {
      await prisma.organizationModule.delete({ where: { id: row.id } });
      console.log(`🗑  ${row.organizationId}: WHATSAPP row removed (CRM already exists)`);
    } else {
      await prisma.organizationModule.update({
        where: { id: row.id },
        data: { moduleCode: 'CRM', displayName: 'CRM', icon: 'SupportAgent', config: { route: '/portal/crm' } },
      });
      console.log(`🔄 ${row.organizationId}: WHATSAPP module row renamed to CRM (enabled=${row.enabled})`);
    }
  }
  if (!rows.length) console.log('No WHATSAPP OrganizationModule rows found.');

  const roles = await prisma.role.findMany({ where: { allowedModules: { has: 'WHATSAPP' } } });
  for (const role of roles) {
    const updated = Array.from(new Set(role.allowedModules.map((m) => (m === 'WHATSAPP' ? 'CRM' : m))));
    await prisma.role.update({ where: { id: role.id }, data: { allowedModules: updated } });
    console.log(`🔄 role ${role.name} (${role.organizationId}): allowedModules WHATSAPP → CRM`);
  }
  if (!roles.length) console.log('No roles referencing WHATSAPP in allowedModules.');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
