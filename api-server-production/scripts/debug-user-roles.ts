// scripts/debug-user-roles.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugUserRoles() {
  try {
    const userId = process.argv[2];

    if (!userId) {
      console.error('Please provide a user ID as an argument.');
      console.error('Usage: npm run debug-user-roles <userId>');
      return;
    }

    console.log(`🔍 Debugging user roles for: ${userId}`);
    console.log('='.repeat(50));

    // Check if user has any UserRole records
    const userRoles = await prisma.userRole.findMany({
      where: {
        userId,
        isActive: true,
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        organization: true,
      },
    });

    console.log(`\n📋 User Roles Found: ${userRoles.length}`);

    if (userRoles.length === 0) {
      console.log('❌ No active roles found for this user');
      console.log('\n💡 Possible issues:');
      console.log('   • User ID might be incorrect (should be Clerk user ID like user_abc123)');
      console.log('   • Role assignment script might not have worked');
      console.log('   • User might not be active');
    } else {
      userRoles.forEach((userRole, index) => {
        console.log(`\n${index + 1}. Role: ${userRole.role.name}`);
        console.log(`   • Description: ${userRole.role.description}`);
        console.log(`   • Organization: ${userRole.organization.name} (${userRole.organization.id})`);
        console.log(`   • Permissions: ${userRole.role.permissions.length}`);
        console.log(`   • Active: ${userRole.isActive}`);
        console.log(`   • Assigned: ${userRole.assignedAt}`);

        if (userRole.role.name === 'osirisadmin') {
          console.log('   🌟 OsirisAdmin role detected!');
        }

        const hasOrgUpdate = userRole.role.permissions.some((p) => p.name === 'organizations:update');
        console.log(`   • Has 'organizations:update': ${hasOrgUpdate ? '✅' : '❌'}`);
      });
    }

    // Check UserOrganization relationships
    const userOrgs = await prisma.userOrganization.findMany({
      where: {
        userId,
        isActive: true,
      },
      include: {
        organization: true,
      },
    });

    console.log(`\n🏢 User Organizations: ${userOrgs.length}`);
    userOrgs.forEach((userOrg, index) => {
      console.log(`${index + 1}. ${userOrg.organization.name} (${userOrg.organization.id})`);
      console.log(`   • Active: ${userOrg.isActive}`);
      console.log(`   • Joined: ${userOrg.joinedAt}`);
    });

    // Final capability check: does user have organizations:update in their current org?
    const currentOrgId = userOrgs[0]?.organization.id;
    if (currentOrgId) {
      const hasUpdateInCurrentOrg = userRoles.some((ur) => ur.organization.id === currentOrgId && ur.role.permissions.some((p) => p.name === 'organizations:update'));
      console.log(`\n✅ Can update current org (${currentOrgId}): ${hasUpdateInCurrentOrg ? 'YES' : 'NO'}`);
    }

    // Check if osirisadmin role exists
    const osirisAdminRole = await prisma.role.findFirst({
      where: { name: 'osirisadmin' },
      include: {
        permissions: true,
      },
    });

    console.log(`\n🔑 OsirisAdmin Role Status:`);
    if (osirisAdminRole) {
      console.log(`✅ OsirisAdmin role exists`);
      console.log(`   • ID: ${osirisAdminRole.id}`);
      console.log(`   • Permissions: ${osirisAdminRole.permissions.length}`);

      // Check if user has the required permission
      const hasOrgReadUserPermission = osirisAdminRole.permissions.some((p) => p.name === 'organizations:read-user');
      console.log(`   • Has 'organizations:read-user': ${hasOrgReadUserPermission ? '✅' : '❌'}`);
    } else {
      console.log(`❌ OsirisAdmin role not found`);
    }

    // List all organizations
    const allOrgs = await prisma.organization.findMany();
    console.log(`\n🌐 All Organizations (${allOrgs.length}):`);
    allOrgs.forEach((org, index) => {
      console.log(`${index + 1}. ${org.name} (${org.id})`);
    });
  } catch (error) {
    console.error('Error debugging user roles:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugUserRoles();
