/**
 * Set the WhatsApp number on a member's profile, which is how the Operator
 * recognises them (no /link code needed).
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_set-member-whatsapp.ts <orgId> <clerkUserId> <number> [--apply] dotenv_config_path=.env.production
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const a = process.argv.slice(2).filter((x) => !x.startsWith('--') && !x.startsWith('dotenv_'));
  const [organizationId, userId, raw] = a;
  const digits = String(raw || '').replace(/\D/g, '');
  if (!organizationId || !userId || !digits) throw new Error('Usage: <orgId> <clerkUserId> <number> [--apply]');

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  if (!org) throw new Error('Organization not found');

  // The same number on two people makes resolve() refuse to act, so check.
  const clash = await prisma.organizationMemberProfile.findMany({
    where: { whatsappNumber: digits, NOT: { userId } },
    select: { userId: true, organizationId: true },
  });
  if (clash.length) {
    console.log('⚠️  That number is already on another member profile:');
    for (const c of clash) console.log(`   ${c.userId} in ${c.organizationId}`);
    throw new Error('Refusing — the Operator ignores a number held by more than one user.');
  }

  const existing = await prisma.organizationMemberProfile.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { whatsappNumber: true },
  });
  console.log(`${org.name}`);
  console.log(`  user:   ${userId}`);
  console.log(`  number: ${existing?.whatsappNumber || '(not set)'}  ->  ${digits}`);
  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.');
    return;
  }
  await prisma.organizationMemberProfile.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    update: { whatsappNumber: digits },
    create: { organizationId, userId, whatsappNumber: digits },
  });
  console.log('\n✅ Linked. The Operator will recognise this number as that user, scoped to this org.');
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
