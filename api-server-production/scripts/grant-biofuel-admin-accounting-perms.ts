import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Complete accounting-suite permission set (from the @Permissions decorators on
// payments / bills / statements / accounting / journal / bank-rec controllers).
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
  // 1) Ensure every permission row exists.
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
  console.log(`Ensured ${permIds.length} permissions exist.`);

  // 2) Find Biofuel's Admin role.
  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'Biofuel', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error('Biofuel org not found');

  const role = await prisma.role.findFirst({
    where: { organizationId: org.id, name: { equals: 'Admin', mode: 'insensitive' } },
    include: { permissions: { select: { id: true } } },
  });
  if (!role) throw new Error(`No "Admin" role found for ${org.name}`);

  // 3) Connect any missing permissions.
  const have = new Set(role.permissions.map((p) => p.id));
  const toConnect = permIds.filter((id) => !have.has(id)).map((id) => ({ id }));
  if (toConnect.length === 0) {
    console.log(`${org.name} / ${role.name}: already has all ${permIds.length} permissions.`);
  } else {
    await prisma.role.update({ where: { id: role.id }, data: { permissions: { connect: toConnect } } });
    console.log(`${org.name} / ${role.name}: granted ${toConnect.length} new permission(s).`);
  }

  // 4) Verify final count of suite perms on the role.
  const after = await prisma.role.findUnique({
    where: { id: role.id },
    include: { permissions: { where: { id: { in: permIds } }, select: { name: true } } },
  });
  console.log(`${org.name} / ${role.name} now has ${after?.permissions.length}/${permIds.length} suite perms:`);
  console.log('  ' + (after?.permissions.map((p) => p.name).sort().join(', ') ?? ''));
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
