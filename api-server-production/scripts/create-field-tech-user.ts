/**
 * One-off: create a Clerk user + attach them to an organization with ONLY
 * the field-tech role (so FieldOnlyGuard locks them into /scan).
 *
 * Usage:
 *   npx ts-node scripts/create-field-tech-user.ts <email> <orgName>
 *
 * Example:
 *   npx ts-node scripts/create-field-tech-user.ts elroy.lee@osiris.so "Osiris Technology Pte. Ltd."
 *
 * The temporary password is generated and printed at the end — share it
 * with the user; they can change it after signing in.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

function genPassword(): string {
  // 16 chars, mixed case + digits + symbols, easy to type once
  const buf = randomBytes(12).toString('base64').replace(/[+/=]/g, '');
  return `Fld!${buf.slice(0, 12)}`;
}

function guessName(email: string): { firstName: string; lastName: string } {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return {
    firstName: cap(parts[0] ?? 'Field'),
    lastName: cap(parts[1] ?? 'Tech'),
  };
}

async function main() {
  const email = process.argv[2];
  const orgName = process.argv[3];
  if (!email || !orgName) {
    console.error('Usage: npx ts-node scripts/create-field-tech-user.ts <email> <orgName>');
    process.exit(1);
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey) {
    console.error('CLERK_SECRET_KEY not found in env.');
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey, publishableKey });

  console.log(`🔍 Looking up org "${orgName}"...`);
  const org = await prisma.organization.findFirst({ where: { name: orgName } });
  if (!org) {
    console.error(`Organization not found: ${orgName}`);
    process.exit(1);
  }
  console.log(`   ✅ ${org.name} (${org.id})`);

  console.log(`🔍 Looking up field-tech role in this org...`);
  const role = await prisma.role.findFirst({
    where: { name: 'field-tech', organizationId: org.id },
  });
  if (!role) {
    console.error('field-tech role missing. Run: npx ts-node scripts/setup-field-tech-role.ts');
    process.exit(1);
  }
  console.log(`   ✅ ${role.name} (${role.id})`);

  // Either find existing Clerk user or create one
  console.log(`🔍 Checking Clerk for existing user with email ${email}...`);
  const existing = await clerk.users.getUserList({ emailAddress: [email] });
  let clerkUser = existing.data[0];
  let tempPassword: string | null = null;

  if (clerkUser) {
    console.log(`   ℹ️  Clerk user already exists: ${clerkUser.id}`);
  } else {
    const { firstName, lastName } = guessName(email);
    tempPassword = genPassword();
    console.log(`📝 Creating Clerk user (${firstName} ${lastName})...`);
    clerkUser = await clerk.users.createUser({
      emailAddress: [email],
      password: tempPassword,
      firstName,
      lastName,
      skipPasswordChecks: false,
      skipPasswordRequirement: false,
    });
    console.log(`   ✅ Created Clerk user ${clerkUser.id}`);
  }

  console.log(`🔗 Attaching to organization (UserOrganization)...`);
  await prisma.userOrganization.upsert({
    where: {
      userId_organizationId: { userId: clerkUser.id, organizationId: org.id },
    },
    update: { isActive: true },
    create: { userId: clerkUser.id, organizationId: org.id, isActive: true },
  });

  console.log(`🧹 Removing any other roles in this org...`);
  const removed = await prisma.userRole.deleteMany({
    where: {
      userId: clerkUser.id,
      organizationId: org.id,
      roleId: { not: role.id },
    },
  });
  if (removed.count > 0) console.log(`   • Removed ${removed.count} other role(s)`);

  console.log(`🎯 Assigning field-tech role...`);
  await prisma.userRole.upsert({
    where: {
      userId_roleId_organizationId: {
        userId: clerkUser.id,
        roleId: role.id,
        organizationId: org.id,
      },
    },
    update: { isActive: true },
    create: {
      userId: clerkUser.id,
      roleId: role.id,
      organizationId: org.id,
      isActive: true,
    },
  });

  console.log('\n🎉 Done.\n');
  console.log(`   Email:     ${email}`);
  console.log(`   Clerk ID:  ${clerkUser.id}`);
  console.log(`   Org:       ${org.name}`);
  console.log(`   Role:      field-tech (locked — FieldOnlyGuard will redirect to /scan)`);
  if (tempPassword) {
    console.log(`   Password:  ${tempPassword}`);
    console.log('\n   ⚠️  Share this password securely; user should change it after first sign-in.');
  } else {
    console.log('\n   ℹ️  User already existed in Clerk — their existing password is unchanged.');
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
