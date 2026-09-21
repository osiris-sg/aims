/**
 * Who is a chat number linked to, and what orgs would /org show them?
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_whoami-operator.ts 6591151041 dotenv_config_path=.env.production
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const digits = (process.argv[2] || '').replace(/\D/g, '');
  if (!digits) throw new Error('Pass the WhatsApp number, e.g. 6591151041');

  const identity = await prisma.operatorIdentity.findFirst({
    where: { channel: 'whatsapp', channelUserId: { contains: digits.slice(-8) } },
  });
  if (!identity) {
    console.log(`No OperatorIdentity for a number containing ${digits.slice(-8)}.`);
    return;
  }
  console.log(`identity     ${identity.channelUserId}  verified=${identity.verified}`);
  console.log(`clerkUserId  ${identity.clerkUserId}`);
  console.log(`stored org   ${identity.organizationId || '(none)'}\n`);

  const roles = await prisma.userRole.findMany({
    where: { userId: identity.clerkUserId, isActive: true },
    select: { organizationId: true, role: { select: { name: true } } },
  });
  const isOsirisAdmin = roles.some((r) => r.role?.name === 'osirisadmin');
  console.log(`roles        ${roles.map((r) => r.role?.name).join(', ') || '(none)'}`);
  console.log(`osirisadmin  ${isOsirisAdmin ? 'YES -> /org lists ALL orgs' : 'no  -> /org lists memberships only'}\n`);

  const memberships = await prisma.userOrganization.findMany({
    where: { userId: identity.clerkUserId, isActive: true },
    select: { organization: { select: { id: true, name: true } } },
  });
  console.log(`memberships (${memberships.length}):`);
  for (const m of memberships) console.log(`  • ${m.organization?.name}`);

  const all = await prisma.organization.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  const names = new Set(memberships.map((m) => m.organization?.name));
  const missing = all.filter((o) => !names.has(o.name));
  console.log(`\nnot a member of (${missing.length}):`);
  for (const o of missing) console.log(`  • ${o.name}`);
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
