import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find the Test Organization
  const testOrg = await prisma.organization.findFirst({
    where: { name: 'Test Organization' }
  });

  if (!testOrg) {
    console.error('Test Organization not found');
    return;
  }

  console.log(`Found Test Organization: ${testOrg.id}`);

  // Get the send-email and payment-summary permissions
  const sendEmailPermission = await prisma.permission.findUnique({
    where: { name: 'documents:send-email' }
  });

  const paymentSummaryPermission = await prisma.permission.findUnique({
    where: { name: 'documents:payment-summary' }
  });

  if (!sendEmailPermission || !paymentSummaryPermission) {
    console.error('Email permissions not found. Please run seed first.');
    return;
  }

  // Find all roles in Test Organization
  const roles = await prisma.role.findMany({
    where: { organizationId: testOrg.id },
    include: { permissions: true }
  });

  console.log(`Found ${roles.length} roles in Test Organization`);

  // Add permissions to each role (you can modify this to be more selective)
  for (const role of roles) {
    // Check if the role already has these permissions
    const hasEmailPermission = role.permissions.some(p => p.id === sendEmailPermission.id);
    const hasPaymentPermission = role.permissions.some(p => p.id === paymentSummaryPermission.id);

    if (!hasEmailPermission || !hasPaymentPermission) {
      console.log(`Adding email permissions to role: ${role.name}`);

      await prisma.role.update({
        where: { id: role.id },
        data: {
          permissions: {
            connect: [
              ...(hasEmailPermission ? [] : [{ id: sendEmailPermission.id }]),
              ...(hasPaymentPermission ? [] : [{ id: paymentSummaryPermission.id }])
            ]
          }
        }
      });

      console.log(`✅ Updated role: ${role.name}`);
    } else {
      console.log(`Role ${role.name} already has email permissions`);
    }
  }

  // Also add payment permissions if they don't exist
  const paymentPermissions = await prisma.permission.findMany({
    where: {
      resource: 'payments',
      action: { in: ['create', 'read', 'update', 'delete'] }
    }
  });

  const transactionPermissions = await prisma.permission.findMany({
    where: {
      resource: 'transactions',
      action: { in: ['create', 'read', 'update', 'delete'] }
    }
  });

  const statementPermission = await prisma.permission.findUnique({
    where: { name: 'statements:read' }
  });

  // Add these to all roles in Test Organization (or you can be more selective)
  for (const role of roles) {
    const permissionsToAdd = [
      ...paymentPermissions,
      ...transactionPermissions,
      ...(statementPermission ? [statementPermission] : [])
    ].filter(p => !role.permissions.some(rp => rp.id === p.id));

    if (permissionsToAdd.length > 0) {
      console.log(`Adding ${permissionsToAdd.length} payment/transaction permissions to role: ${role.name}`);

      await prisma.role.update({
        where: { id: role.id },
        data: {
          permissions: {
            connect: permissionsToAdd.map(p => ({ id: p.id }))
          }
        }
      });

      console.log(`✅ Added payment permissions to role: ${role.name}`);
    }
  }

  console.log('✅ All permissions have been added successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });