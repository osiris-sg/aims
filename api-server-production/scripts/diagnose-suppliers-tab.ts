#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'Biofuel', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!org) {
    console.log('No org matching "Biofuel" found.');
    return;
  }
  console.log(`\nOrg: ${org.name} (${org.id})\n`);

  // 1) SUPPLIERS module row
  const mod = await prisma.organizationModule.findUnique({
    where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: 'SUPPLIERS' } },
  });
  console.log('--- OrganizationModule SUPPLIERS ---');
  console.log(mod ? { enabled: mod.enabled, displayName: mod.displayName, sortOrder: mod.sortOrder, config: mod.config } : 'NO SUPPLIERS ROW');

  // 2) Roles + allowedModules in this org
  const roles = await prisma.role.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, allowedModules: true },
  });
  console.log('\n--- Roles (allowedModules) ---');
  for (const r of roles) {
    const allowed = r.allowedModules ?? [];
    const blocksSuppliers = allowed.length > 0 && !allowed.includes('SUPPLIERS');
    console.log(`${r.name}: ${allowed.length === 0 ? '[] (no restriction = allow all)' : JSON.stringify(allowed)}${blocksSuppliers ? '   <-- HIDES SUPPLIERS' : ''}`);
  }

  // 3) suppliers permissions present in this org?
  const supPerms = await prisma.permission.findMany({
    where: { resource: 'suppliers' },
    select: { id: true, name: true, resource: true, action: true },
  });
  console.log(`\n--- suppliers:* permissions defined: ${supPerms.length} ---`);
  console.log(supPerms.map((p) => p.name).join(', ') || '(none)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
