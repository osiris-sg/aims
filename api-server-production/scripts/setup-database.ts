import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function setupDatabase() {
  try {
    console.log('🚀 Starting database setup...\n');

    // Step 1: Seed permissions and roles
    console.log('📋 Step 1: Creating permissions and roles...');
    await seedPermissionsAndRoles();
    console.log('✅ Permissions and roles created successfully\n');

    // Step 2: Create default organization
    console.log('🏢 Step 2: Creating default organization...');
    const organization = await createDefaultOrganization();
    console.log(`✅ Default organization created: ${organization.name} (${organization.id})\n`);

    // Step 3: Create document templates
    console.log('📄 Step 3: Creating document templates...');
    await createDocumentTemplates(organization.id);
    console.log('✅ Document templates created successfully\n');

    // Step 4: Assign user if provided
    const userId = process.argv[2];
    if (userId) {
      console.log(`👤 Step 4: Setting up user ${userId}...`);
      await setupUser(userId, organization.id);
      console.log('✅ User setup completed successfully\n');
    } else {
      console.log('ℹ️  Step 4: No user ID provided. User setup skipped.\n');
      console.log('💡 To set up a user later, run: npm run setup-user <userId>');
    }

    console.log('🎉 Database setup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`   • Organization: ${organization.name} (${organization.id})`);
    console.log(`   • Document Templates: 3 created`);
    console.log(`   • Roles: superadmin, user`);
    console.log(`   • Permissions: All resource permissions`);
    if (userId) {
      console.log(`   • User: ${userId} (superadmin)`);
    }
  } catch (error) {
    console.error('❌ Error during database setup:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function seedPermissionsAndRoles() {
  // Create permissions for role management
  const createRolePermission = await prisma.permission.upsert({
    where: { name: 'roles:create' },
    update: {},
    create: {
      name: 'roles:create',
      description: 'Can create roles',
      resource: 'roles',
      action: 'create',
    },
  });

  const readRolePermission = await prisma.permission.upsert({
    where: { name: 'roles:read' },
    update: {},
    create: {
      name: 'roles:read',
      description: 'Can read roles',
      resource: 'roles',
      action: 'read',
    },
  });

  const updateRolePermission = await prisma.permission.upsert({
    where: { name: 'roles:update' },
    update: {},
    create: {
      name: 'roles:update',
      description: 'Can update roles',
      resource: 'roles',
      action: 'update',
    },
  });

  const deleteRolePermission = await prisma.permission.upsert({
    where: { name: 'roles:delete' },
    update: {},
    create: {
      name: 'roles:delete',
      description: 'Can delete roles',
      resource: 'roles',
      action: 'delete',
    },
  });

  // Create permissions for permission management
  const createPermissionPermission = await prisma.permission.upsert({
    where: { name: 'permissions:create' },
    update: {},
    create: {
      name: 'permissions:create',
      description: 'Can create permissions',
      resource: 'permissions',
      action: 'create',
    },
  });

  const readPermissionPermission = await prisma.permission.upsert({
    where: { name: 'permissions:read' },
    update: {},
    create: {
      name: 'permissions:read',
      description: 'Can read permissions',
      resource: 'permissions',
      action: 'read',
    },
  });

  const updatePermissionPermission = await prisma.permission.upsert({
    where: { name: 'permissions:update' },
    update: {},
    create: {
      name: 'permissions:update',
      description: 'Can update permissions',
      resource: 'permissions',
      action: 'update',
    },
  });

  const deletePermissionPermission = await prisma.permission.upsert({
    where: { name: 'permissions:delete' },
    update: {},
    create: {
      name: 'permissions:delete',
      description: 'Can delete permissions',
      resource: 'permissions',
      action: 'delete',
    },
  });

  // Create permissions for user role management
  const assignRolePermission = await prisma.permission.upsert({
    where: { name: 'users:assign-role' },
    update: {},
    create: {
      name: 'users:assign-role',
      description: 'Can assign roles to users',
      resource: 'users',
      action: 'assign-role',
    },
  });

  const removeRolePermission = await prisma.permission.upsert({
    where: { name: 'users:remove-role' },
    update: {},
    create: {
      name: 'users:remove-role',
      description: 'Can remove roles from users',
      resource: 'users',
      action: 'remove-role',
    },
  });

  const readRolesPermission = await prisma.permission.upsert({
    where: { name: 'users:read-roles' },
    update: {},
    create: {
      name: 'users:read-roles',
      description: 'Can read user roles',
      resource: 'users',
      action: 'read-roles',
    },
  });

  // Create permissions for assets
  const readAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:read' },
    update: {},
    create: {
      name: 'assets:read',
      description: 'Can read assets',
      resource: 'assets',
      action: 'read',
    },
  });

  const readAssetsSkuPermission = await prisma.permission.upsert({
    where: { name: 'assets:read-sku' },
    update: {},
    create: {
      name: 'assets:read-sku',
      description: 'Can read assets sku',
      resource: 'assets',
      action: 'read-sku',
    },
  });

  const readAssetsIdPermission = await prisma.permission.upsert({
    where: { name: 'assets:read-id' },
    update: {},
    create: {
      name: 'assets:read-id',
      description: 'Can read assets id',
      resource: 'assets',
      action: 'read-id',
    },
  });

  const createAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:create' },
    update: {},
    create: {
      name: 'assets:create',
      description: 'Can create assets',
      resource: 'assets',
      action: 'create',
    },
  });

  const updateAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:update' },
    update: {},
    create: {
      name: 'assets:update',
      description: 'Can update assets',
      resource: 'assets',
      action: 'update',
    },
  });

  const deleteAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:delete' },
    update: {},
    create: {
      name: 'assets:delete',
      description: 'Can delete assets',
      resource: 'assets',
      action: 'delete',
    },
  });

  const checkAssetsSkuPermission = await prisma.permission.upsert({
    where: { name: 'assets:check-sku' },
    update: {},
    create: {
      name: 'assets:check-sku',
      description: 'Can check sku',
      resource: 'assets',
      action: 'check-sku',
    },
  });

  // Create permissions for customers
  const createCustomerPermission = await prisma.permission.upsert({
    where: { name: 'customers:create' },
    update: {},
    create: {
      name: 'customers:create',
      description: 'Can create customers',
      resource: 'customers',
      action: 'create',
    },
  });

  const readCustomerPermission = await prisma.permission.upsert({
    where: { name: 'customers:read' },
    update: {},
    create: {
      name: 'customers:read',
      description: 'Can read customers',
      resource: 'customers',
      action: 'read',
    },
  });

  const updateCustomerPermission = await prisma.permission.upsert({
    where: { name: 'customers:update' },
    update: {},
    create: {
      name: 'customers:update',
      description: 'Can update customers',
      resource: 'customers',
      action: 'update',
    },
  });

  const deleteCustomerPermission = await prisma.permission.upsert({
    where: { name: 'customers:delete' },
    update: {},
    create: {
      name: 'customers:delete',
      description: 'Can delete customers',
      resource: 'customers',
      action: 'delete',
    },
  });

  // Create permissions for inventory
  const createInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventory:create' },
    update: {},
    create: {
      name: 'inventory:create',
      description: 'Can create inventory',
      resource: 'inventory',
      action: 'create',
    },
  });

  const readInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventory:read' },
    update: {},
    create: {
      name: 'inventory:read',
      description: 'Can read inventory',
      resource: 'inventory',
      action: 'read',
    },
  });

  const updateInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventory:update' },
    update: {},
    create: {
      name: 'inventory:update',
      description: 'Can update inventory',
      resource: 'inventory',
      action: 'update',
    },
  });

  const deleteInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventory:delete' },
    update: {},
    create: {
      name: 'inventory:delete',
      description: 'Can delete inventory',
      resource: 'inventory',
      action: 'delete',
    },
  });

  // Create permissions for documents
  const createDocumentPermission = await prisma.permission.upsert({
    where: { name: 'documents:create' },
    update: {},
    create: {
      name: 'documents:create',
      description: 'Can create documents',
      resource: 'documents',
      action: 'create',
    },
  });

  const readDocumentPermission = await prisma.permission.upsert({
    where: { name: 'documents:read' },
    update: {},
    create: {
      name: 'documents:read',
      description: 'Can read documents',
      resource: 'documents',
      action: 'read',
    },
  });

  const updateDocumentPermission = await prisma.permission.upsert({
    where: { name: 'documents:update' },
    update: {},
    create: {
      name: 'documents:update',
      description: 'Can update documents',
      resource: 'documents',
      action: 'update',
    },
  });

  const deleteDocumentPermission = await prisma.permission.upsert({
    where: { name: 'documents:delete' },
    update: {},
    create: {
      name: 'documents:delete',
      description: 'Can delete documents',
      resource: 'documents',
      action: 'delete',
    },
  });

  // Create permissions for document templates
  const createDocumentTemplatePermission = await prisma.permission.upsert({
    where: { name: 'documentTemplates:create' },
    update: {},
    create: {
      name: 'documentTemplates:create',
      description: 'Can create document templates',
      resource: 'documentTemplates',
      action: 'create',
    },
  });

  const readDocumentTemplatePermission = await prisma.permission.upsert({
    where: { name: 'documentTemplates:read' },
    update: {},
    create: {
      name: 'documentTemplates:read',
      description: 'Can read document templates',
      resource: 'documentTemplates',
      action: 'read',
    },
  });

  const updateDocumentTemplatePermission = await prisma.permission.upsert({
    where: { name: 'documentTemplates:update' },
    update: {},
    create: {
      name: 'documentTemplates:update',
      description: 'Can update document templates',
      resource: 'documentTemplates',
      action: 'update',
    },
  });

  const deleteDocumentTemplatePermission = await prisma.permission.upsert({
    where: { name: 'documentTemplates:delete' },
    update: {},
    create: {
      name: 'documentTemplates:delete',
      description: 'Can delete document templates',
      resource: 'documentTemplates',
      action: 'delete',
    },
  });

  // Create permissions for projects
  const createProjectPermission = await prisma.permission.upsert({
    where: { name: 'projects:create' },
    update: {},
    create: {
      name: 'projects:create',
      description: 'Can create projects',
      resource: 'projects',
      action: 'create',
    },
  });

  const readProjectPermission = await prisma.permission.upsert({
    where: { name: 'projects:read' },
    update: {},
    create: {
      name: 'projects:read',
      description: 'Can read projects',
      resource: 'projects',
      action: 'read',
    },
  });

  const updateProjectPermission = await prisma.permission.upsert({
    where: { name: 'projects:update' },
    update: {},
    create: {
      name: 'projects:update',
      description: 'Can update projects',
      resource: 'projects',
      action: 'update',
    },
  });

  const deleteProjectPermission = await prisma.permission.upsert({
    where: { name: 'projects:delete' },
    update: {},
    create: {
      name: 'projects:delete',
      description: 'Can delete projects',
      resource: 'projects',
      action: 'delete',
    },
  });

  // Create permissions for categories
  const createCategoryPermission = await prisma.permission.upsert({
    where: { name: 'categories:create' },
    update: {},
    create: {
      name: 'categories:create',
      description: 'Can create categories',
      resource: 'categories',
      action: 'create',
    },
  });

  const readCategoryPermission = await prisma.permission.upsert({
    where: { name: 'categories:read' },
    update: {},
    create: {
      name: 'categories:read',
      description: 'Can read categories',
      resource: 'categories',
      action: 'read',
    },
  });

  const updateCategoryPermission = await prisma.permission.upsert({
    where: { name: 'categories:update' },
    update: {},
    create: {
      name: 'categories:update',
      description: 'Can update categories',
      resource: 'categories',
      action: 'update',
    },
  });

  const deleteCategoryPermission = await prisma.permission.upsert({
    where: { name: 'categories:delete' },
    update: {},
    create: {
      name: 'categories:delete',
      description: 'Can delete categories',
      resource: 'categories',
      action: 'delete',
    },
  });

  // Create superadmin role with all permissions
  await prisma.role.upsert({
    where: { name: 'superadmin' },
    update: {
      permissions: {
        connect: [
          { id: createRolePermission.id },
          { id: readRolePermission.id },
          { id: updateRolePermission.id },
          { id: deleteRolePermission.id },
          { id: createPermissionPermission.id },
          { id: readPermissionPermission.id },
          { id: updatePermissionPermission.id },
          { id: deletePermissionPermission.id },
          { id: assignRolePermission.id },
          { id: removeRolePermission.id },
          { id: readRolesPermission.id },
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: createAssetsPermission.id },
          { id: updateAssetsPermission.id },
          { id: deleteAssetsPermission.id },
          { id: checkAssetsSkuPermission.id },
          { id: createCustomerPermission.id },
          { id: readCustomerPermission.id },
          { id: updateCustomerPermission.id },
          { id: deleteCustomerPermission.id },
          { id: createInventoryPermission.id },
          { id: readInventoryPermission.id },
          { id: updateInventoryPermission.id },
          { id: deleteInventoryPermission.id },
          { id: createDocumentPermission.id },
          { id: readDocumentPermission.id },
          { id: updateDocumentPermission.id },
          { id: deleteDocumentPermission.id },
          { id: createDocumentTemplatePermission.id },
          { id: readDocumentTemplatePermission.id },
          { id: updateDocumentTemplatePermission.id },
          { id: deleteDocumentTemplatePermission.id },
          { id: createProjectPermission.id },
          { id: readProjectPermission.id },
          { id: updateProjectPermission.id },
          { id: deleteProjectPermission.id },
          { id: createCategoryPermission.id },
          { id: readCategoryPermission.id },
          { id: updateCategoryPermission.id },
          { id: deleteCategoryPermission.id },
        ],
      },
    },
    create: {
      name: 'superadmin',
      description: 'Super Administrator with all permissions',
      permissions: {
        connect: [
          { id: createRolePermission.id },
          { id: readRolePermission.id },
          { id: updateRolePermission.id },
          { id: deleteRolePermission.id },
          { id: createPermissionPermission.id },
          { id: readPermissionPermission.id },
          { id: updatePermissionPermission.id },
          { id: deletePermissionPermission.id },
          { id: assignRolePermission.id },
          { id: removeRolePermission.id },
          { id: readRolesPermission.id },
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: createAssetsPermission.id },
          { id: updateAssetsPermission.id },
          { id: deleteAssetsPermission.id },
          { id: checkAssetsSkuPermission.id },
          { id: createCustomerPermission.id },
          { id: readCustomerPermission.id },
          { id: updateCustomerPermission.id },
          { id: deleteCustomerPermission.id },
          { id: createInventoryPermission.id },
          { id: readInventoryPermission.id },
          { id: updateInventoryPermission.id },
          { id: deleteInventoryPermission.id },
          { id: createDocumentPermission.id },
          { id: readDocumentPermission.id },
          { id: updateDocumentPermission.id },
          { id: deleteDocumentPermission.id },
          { id: createDocumentTemplatePermission.id },
          { id: readDocumentTemplatePermission.id },
          { id: updateDocumentTemplatePermission.id },
          { id: deleteDocumentTemplatePermission.id },
          { id: createProjectPermission.id },
          { id: readProjectPermission.id },
          { id: updateProjectPermission.id },
          { id: deleteProjectPermission.id },
          { id: createCategoryPermission.id },
          { id: readCategoryPermission.id },
          { id: updateCategoryPermission.id },
          { id: deleteCategoryPermission.id },
        ],
      },
    },
  });

  // Create regular user role with limited permissions
  await prisma.role.upsert({
    where: { name: 'user' },
    update: {
      permissions: {
        connect: [
          { id: readRolePermission.id },
          { id: readPermissionPermission.id },
          { id: readRolesPermission.id },
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: readCustomerPermission.id },
          { id: readInventoryPermission.id },
          { id: readDocumentPermission.id },
          { id: readDocumentTemplatePermission.id },
          { id: readProjectPermission.id },
          { id: readCategoryPermission.id },
        ],
      },
    },
    create: {
      name: 'user',
      description: 'Regular user with limited permissions',
      permissions: {
        connect: [
          { id: readRolePermission.id },
          { id: readPermissionPermission.id },
          { id: readRolesPermission.id },
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: readCustomerPermission.id },
          { id: readInventoryPermission.id },
          { id: readDocumentPermission.id },
          { id: readDocumentTemplatePermission.id },
          { id: readProjectPermission.id },
          { id: readCategoryPermission.id },
        ],
      },
    },
  });
}

async function createDefaultOrganization() {
  // Check if organization already exists
  let organization = await prisma.organization.findFirst();

  if (!organization) {
    organization = await prisma.organization.create({
      data: {
        name: 'Default Organization',
      },
    });
  }

  return organization;
}

async function createDocumentTemplates(organizationId: string) {
  const templates = [
    {
      name: 'Delivery Order (DO)',
      type: 'DO',
      description: 'Standard delivery order template',
      content: JSON.stringify({
        sections: [
          {
            title: 'Header',
            fields: ['documentNumber', 'date', 'customerName', 'customerAddress'],
          },
          {
            title: 'Items',
            fields: ['items'],
          },
          {
            title: 'Footer',
            fields: ['totalAmount', 'notes', 'signature'],
          },
        ],
      }),
    },
    {
      name: 'Return Delivery Order (RDO)',
      type: 'RDO',
      description: 'Standard return delivery order template',
      content: JSON.stringify({
        sections: [
          {
            title: 'Header',
            fields: ['documentNumber', 'date', 'customerName', 'customerAddress', 'returnReason'],
          },
          {
            title: 'Returned Items',
            fields: ['items'],
          },
          {
            title: 'Footer',
            fields: ['totalAmount', 'notes', 'signature'],
          },
        ],
      }),
    },
    {
      name: 'Invoice',
      type: 'INVOICE',
      description: 'Standard invoice template',
      content: JSON.stringify({
        sections: [
          {
            title: 'Header',
            fields: ['invoiceNumber', 'date', 'dueDate', 'customerName', 'customerAddress'],
          },
          {
            title: 'Items',
            fields: ['items'],
          },
          {
            title: 'Summary',
            fields: ['subtotal', 'tax', 'totalAmount'],
          },
          {
            title: 'Footer',
            fields: ['paymentTerms', 'notes'],
          },
        ],
      }),
    },
  ];

  for (const template of templates) {
    // Check if template already exists for this organization
    const existingTemplate = await prisma.documentTemplate.findFirst({
      where: {
        name: template.name,
        organizationId: organizationId,
      },
    });

    if (existingTemplate) {
      // Update existing template
      await prisma.documentTemplate.update({
        where: { id: existingTemplate.id },
        data: {
          type: template.type,
          config: template.content,
        },
      });
    } else {
      // Create new template
      await prisma.documentTemplate.create({
        data: {
          name: template.name,
          type: template.type,
          config: template.content,
          organizationId: organizationId,
        },
      });
    }
  }
}

async function setupUser(userId: string, organizationId: string) {
  // Get the superadmin role
  const superadminRole = await prisma.role.findUnique({
    where: { name: 'superadmin' },
  });

  if (!superadminRole) {
    throw new Error('Superadmin role not found');
  }

  // Create UserOrganization relationship
  await prisma.userOrganization.upsert({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
    update: {
      isActive: true,
    },
    create: {
      userId,
      organizationId,
      isActive: true,
    },
  });

  // Assign superadmin role
  await prisma.userRole.upsert({
    where: {
      userId_roleId_organizationId: {
        userId,
        roleId: superadminRole.id,
        organizationId,
      },
    },
    update: {},
    create: {
      userId,
      roleId: superadminRole.id,
      organizationId,
    },
  });
}

// Run the setup
setupDatabase();
