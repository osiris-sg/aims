import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  // Find the user (look for admin@osiris.sg email)
  const user = await p.user.findFirst({ where: { email: { contains: 'admin@osiris', mode: 'insensitive' } } });
  console.log('User:', user?.email, user?.id);
  
  if (!user) return;
  const uo = await p.userOrganization.findMany({ 
    where: { userId: user.id }, 
    include: { 
      organization: { select: { name: true } },
      role: { select: { name: true, allowedModules: true } },
    },
  });
  console.log('\nUser-Org memberships:');
  uo.forEach(r => {
    console.log(`  ${r.organization.name.padEnd(30)} role=${r.role?.name || 'NONE'} allowedModules=${JSON.stringify(r.role?.allowedModules || [])}`);
  });
}
main().finally(()=>p.$disconnect());
