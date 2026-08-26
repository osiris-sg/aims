// Open Deliveries + Customer Information to ALL roles in Biofuel (prod).
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const APPLY = process.argv.includes('--apply');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const MODULES = ['DELIVERIES', 'CUSTOMER_INFORMATION'];
const PERMS = [
  { resource: 'customer-info', action: 'read' },
  { resource: 'maintenance-reports', action: 'read' }, // deliveries list/detail reads
];
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });

  // 1. Org-level module toggles
  for (const code of MODULES) {
    const row = await p.organizationModule.findFirst({ where: { organizationId: BF, moduleCode: code } });
    console.log(`module ${code}: ${row ? (row.enabled ? 'enabled' : 'DISABLED') : 'MISSING'}`);
    if (APPLY) {
      if (!row) await p.organizationModule.create({ data: { organizationId: BF, moduleCode: code, enabled: true } });
      else if (!row.enabled) await p.organizationModule.update({ where: { id: row.id }, data: { enabled: true } });
    }
  }

  // 2 + 3. Roles: allowedModules + read permissions
  const permRows = await p.permission.findMany({ where: { OR: PERMS } });
  console.log('perm rows found:', permRows.map((x) => `${x.resource}:${x.action}`).join(', ') || 'NONE');
  const roles = await p.role.findMany({ where: { organizationId: BF }, include: { permissions: { select: { id: true, resource: true, action: true } } } });
  for (const r of roles) {
    const restrictive = Array.isArray(r.allowedModules) && r.allowedModules.length > 0;
    const missingModules = restrictive ? MODULES.filter((m) => !r.allowedModules.includes(m)) : [];
    const missingPerms = permRows.filter((pr) => !r.permissions.some((rp) => rp.id === pr.id));
    console.log(`role "${r.name}": allowedModules=${restrictive ? r.allowedModules.length : 'ALL'} | +modules: ${missingModules.join(',') || '-'} | +perms: ${missingPerms.map((x) => `${x.resource}:${x.action}`).join(',') || '-'}`);
    if (APPLY) {
      if (missingModules.length) {
        await p.role.update({ where: { id: r.id }, data: { allowedModules: [...r.allowedModules, ...missingModules] } });
      }
      if (missingPerms.length) {
        await p.role.update({ where: { id: r.id }, data: { permissions: { connect: missingPerms.map((x) => ({ id: x.id })) } } });
      }
    }
  }
  console.log(APPLY ? 'APPLIED' : '(dry run — rerun with --apply)');
  await p.$disconnect();
})();
