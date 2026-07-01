import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

// Roles in Biofuel that should have full accounting access. field-tech is
// intentionally excluded.
const ROLE_NAMES = ['Admin', 'Manager', 'superadmin'];

const PERMS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'accounting', action: 'read', description: 'View chart of accounts and accounting settings' },
  { resource: 'accounting', action: 'create', description: 'Create chart-of-account entries' },
  { resource: 'accounting', action: 'update', description: 'Update chart-of-account entries and settings' },
  { resource: 'accounting', action: 'delete', description: 'Deactivate chart-of-account entries' },
  { resource: 'journal', action: 'read', description: 'View journal entries, trial balance, general ledger' },
  { resource: 'journal', action: 'create', description: 'Create manual journal entries' },
  { resource: 'journal', action: 'post', description: 'Post journal entries' },
  { resource: 'journal', action: 'void', description: 'Void posted journal entries' },
  { resource: 'payments', action: 'read', description: 'View customer payments' },
  { resource: 'payments', action: 'create', description: 'Record customer payments' },
  { resource: 'payments', action: 'update', description: 'Update customer payments' },
  { resource: 'payments', action: 'delete', description: 'Delete customer payments' },
  { resource: 'bills', action: 'read', description: 'View supplier bills' },
  { resource: 'bills', action: 'create', description: 'Create supplier bills' },
  { resource: 'bills', action: 'update', description: 'Update supplier bills' },
  { resource: 'bills', action: 'approve', description: 'Approve / post supplier bills' },
  { resource: 'statements', action: 'read', description: 'View customer/supplier statements & sales/purchase reports' },
  { resource: 'bankrec', action: 'read', description: 'View bank reconciliation' },
  { resource: 'bankrec', action: 'create', description: 'Import statements and match bank-rec lines' },
];

async function main() {
  const permIds: string[] = [];
  for (const { resource, action, description } of PERMS) {
    const name = `${resource}:${action}`;
    const perm = await prisma.permission.upsert({
      where: { name },
      update: { description },
      create: { name, description, resource, action },
    });
    permIds.push(perm.id);
  }

  for (const roleName of ROLE_NAMES) {
    const role = await prisma.role.findFirst({
      where: { organizationId: ORG, name: { equals: roleName, mode: 'insensitive' } },
      include: { permissions: { select: { id: true } } },
    });
    if (!role) {
      console.log(`  (no "${roleName}" role in Biofuel — skipped)`);
      continue;
    }
    const have = new Set(role.permissions.map((p) => p.id));
    const toConnect = permIds.filter((id) => !have.has(id)).map((id) => ({ id }));
    if (toConnect.length === 0) {
      console.log(`  ${role.name}: already has all ${permIds.length} accounting perms`);
    } else {
      await prisma.role.update({ where: { id: role.id }, data: { permissions: { connect: toConnect } } });
      console.log(`  ${role.name}: granted ${toConnect.length} new permission(s) → ${permIds.length}/${permIds.length}`);
    }
  }
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
