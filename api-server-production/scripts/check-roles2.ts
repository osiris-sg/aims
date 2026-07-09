import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const user = await p.user.findFirst({ where: { email: { contains: 'admin@osiris', mode: 'insensitive' } } });
  console.log('User:', user?.email, user?.id);
  if (!user) return;
  
  // All UserRole entries for this user
  const ur = await p.userRole.findMany({
    where: { userId: user.id, isActive: true },
    include: { role: { select: { name: true, allowedModules: true, organizationId: true } }, organization: { select: { name: true } } },
  });
  console.log(`\nUserRole rows (${ur.length}):`);
  ur.forEach(r => console.log(`  org=${r.organization.name.padEnd(30)} role=${r.role.name.padEnd(20)} allowedModules=${JSON.stringify(r.role.allowedModules)}`));

  // Membership rows
  const uo = await p.userOrganization.findMany({ where: { userId: user.id }, include: { organization: { select: { name: true } } } });
  console.log(`\nUserOrganization rows (${uo.length}):`);
  uo.forEach(u => console.log(`  org=${u.organization.name.padEnd(30)} active=${u.isActive}`));
}
main().finally(()=>p.$disconnect());
