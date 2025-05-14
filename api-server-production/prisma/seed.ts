// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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

  const readAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:read' },
    update: {
        name: 'assets:read',
        description: 'Can read assets',
        resource: 'assets',
        action: 'read',
    },
    create: {
      name: 'assets:read',
      description: 'Can read assets',
      resource: 'assets',
      action: 'read',
    },
  });

  const readAssetsSkuPermission = await prisma.permission.upsert({
    where: { name: 'assets:read-sku' },
    update: {
        name: 'assets:read-sku',
        description: 'Can read assets sku',
        resource: 'assets',
        action: 'read-sku',
    },
    create: {
      name: 'assets:read-sku',
      description: 'Can read assets sku',
      resource: 'assets',
      action: 'read-sku',
    },
  });

  const readAssetsIdPermission = await prisma.permission.upsert({
    where: { name: 'assets:read-id' },
    update: {
        name: 'assets:read-id',
        description: 'Can read assets id',
        resource: 'assets',
        action: 'read-id',
    },
    create: {
      name: 'assets:read-id',
      description: 'Can read assets id',
      resource: 'assets',
      action: 'read-id',
    },
  });

  const createAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:create' },
    update: {
        name: 'assets:create',
        description: 'Can create assets',
        resource: 'assets',
        action: 'create',
    },
    create: {
      name: 'assets:create',
      description: 'Can create assets',
      resource: 'assets',
      action: 'create',
    },
  });

  const updateAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:update' },
    update: {
        name: 'assets:update',
        description: 'Can update assets',
        resource: 'assets',
        action: 'update',
    },
    create: {
      name: 'assets:update',
      description: 'Can update assets',
      resource: 'assets',
      action: 'update',
    },
  });

  const deleteAssetsPermission = await prisma.permission.upsert({
    where: { name: 'assets:delete' },
    update: {
        name: 'assets:delete',
        description: 'Can delete assets',
        resource: 'assets',
        action: 'delete',
    },
    create: {
      name: 'assets:delete',
      description: 'Can read delete sku key',
      resource: 'assets',
      action: 'delete',
    },
  });

  const checkAssetsSkuPermission = await prisma.permission.upsert({
    where: { name: 'assets:check-sku' },
    update: {
        name: 'assets:check-sku',
        description: 'Can check sku',
        resource: 'assets',
        action: 'check-sku',
    },
    create: {
      name: 'assets:check-sku',
      description: 'Can check sku',
      resource: 'assets',
      action: 'check-sku',
    },
  });



  // Create superadmin role with all permissions
  const superadminRole = await prisma.role.upsert({
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
        ],
      },
    },
  });

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });