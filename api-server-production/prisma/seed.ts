// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get or create osiris platform organization
  const osirisOrg = await prisma.organization.upsert({
    where: { id: 'osiris-platform' },
    update: {},
    create: {
      id: 'osiris-platform',
      name: 'osiris-platform',
    },
  });

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

  // Create permissions for dashboard
  const dashboardReadPermission = await prisma.permission.upsert({
    where: { name: 'dashboard:read' },
    update: {},
    create: {
      name: 'dashboard:read',
      description: 'Can read dashboard data',
      resource: 'dashboard',
      action: 'read',
    },
  });

  // Create permissions for organizations
  const readUserOrganizationPermission = await prisma.permission.upsert({
    where: { name: 'organizations:read-user' },
    update: {},
    create: {
      name: 'organizations:read-user',
      description: 'Can read user organization',
      resource: 'organizations',
      action: 'read-user',
    },
  });

  const createOrganizationPermission = await prisma.permission.upsert({
    where: { name: 'organizations:create' },
    update: {},
    create: {
      name: 'organizations:create',
      description: 'Can create organizations',
      resource: 'organizations',
      action: 'create',
    },
  });

  const readOrganizationPermission = await prisma.permission.upsert({
    where: { name: 'organizations:read' },
    update: {},
    create: {
      name: 'organizations:read',
      description: 'Can read organizations',
      resource: 'organizations',
      action: 'read',
    },
  });

  const readOneOrganizationPermission = await prisma.permission.upsert({
    where: { name: 'organizations:read-one' },
    update: {},
    create: {
      name: 'organizations:read-one',
      description: 'Can read one organization',
      resource: 'organizations',
      action: 'read-one',
    },
  });

  const updateOrganizationPermission = await prisma.permission.upsert({
    where: { name: 'organizations:update' },
    update: {},
    create: {
      name: 'organizations:update',
      description: 'Can update organizations',
      resource: 'organizations',
      action: 'update',
    },
  });

  const deleteOrganizationPermission = await prisma.permission.upsert({
    where: { name: 'organizations:delete' },
    update: {},
    create: {
      name: 'organizations:delete',
      description: 'Can delete organizations',
      resource: 'organizations',
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

  const readOneCategoryPermission = await prisma.permission.upsert({
    where: { name: 'categories:read-one' },
    update: {},
    create: {
      name: 'categories:read-one',
      description: 'Can read one category',
      resource: 'categories',
      action: 'read-one',
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

  // Create permissions for customers
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

  const readOneCustomerPermission = await prisma.permission.upsert({
    where: { name: 'customers:read-one' },
    update: {},
    create: {
      name: 'customers:read-one',
      description: 'Can read one customer',
      resource: 'customers',
      action: 'read-one',
    },
  });

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

  // Create permissions for documents
  const createDocumentWithTimelinePermission = await prisma.permission.upsert({
    where: { name: 'documents:create-with-timeline' },
    update: {},
    create: {
      name: 'documents:create-with-timeline',
      description: 'Can create documents with timeline',
      resource: 'documents',
      action: 'create-with-timeline',
    },
  });

  const createBasicDocumentPermission = await prisma.permission.upsert({
    where: { name: 'documents:create-basic' },
    update: {},
    create: {
      name: 'documents:create-basic',
      description: 'Can create basic documents',
      resource: 'documents',
      action: 'create-basic',
    },
  });

  const createDocumentRevisionPermission = await prisma.permission.upsert({
    where: { name: 'documents:create-revision' },
    update: {},
    create: {
      name: 'documents:create-revision',
      description: 'Can create document revisions',
      resource: 'documents',
      action: 'create-revision',
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

  const readOneDocumentPermission = await prisma.permission.upsert({
    where: { name: 'documents:read-one' },
    update: {},
    create: {
      name: 'documents:read-one',
      description: 'Can read one document',
      resource: 'documents',
      action: 'read-one',
    },
  });

  const readDocumentByInventoryPermission = await prisma.permission.upsert({
    where: { name: 'documents:read-by-inventory' },
    update: {},
    create: {
      name: 'documents:read-by-inventory',
      description: 'Can read documents by inventory',
      resource: 'documents',
      action: 'read-by-inventory',
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

  const readDocumentByAssetPermission = await prisma.permission.upsert({
    where: { name: 'documents:read-by-asset' },
    update: {},
    create: {
      name: 'documents:read-by-asset',
      description: 'Can read documents by asset',
      resource: 'documents',
      action: 'read-by-asset',
    },
  });

  const tagTemplateToAssetPermission = await prisma.permission.upsert({
    where: { name: 'documents:tag-template-to-asset' },
    update: {},
    create: {
      name: 'documents:tag-template-to-asset',
      description: 'Can tag template to asset',
      resource: 'documents',
      action: 'tag-template-to-asset',
    },
  });

  const untagTemplateFromAssetPermission = await prisma.permission.upsert({
    where: { name: 'documents:untag-template-from-asset' },
    update: {},
    create: {
      name: 'documents:untag-template-from-asset',
      description: 'Can untag template from asset',
      resource: 'documents',
      action: 'untag-template-from-asset',
    },
  });

  // Add send-email permission for documents
  const sendEmailDocumentPermission = await prisma.permission.upsert({
    where: { name: 'documents:send-email' },
    update: {},
    create: {
      name: 'documents:send-email',
      description: 'Can send documents via email',
      resource: 'documents',
      action: 'send-email',
    },
  });

  // Add payment-summary permission for documents
  const getPaymentSummaryPermission = await prisma.permission.upsert({
    where: { name: 'documents:payment-summary' },
    update: {},
    create: {
      name: 'documents:payment-summary',
      description: 'Can get payment summary for invoices',
      resource: 'documents',
      action: 'payment-summary',
    },
  });

  // Create permissions for document extraction
  const extractDocumentPermission = await prisma.permission.upsert({
    where: { name: 'document-extraction:extract' },
    update: {},
    create: {
      name: 'document-extraction:extract',
      description: 'Can extract data from document images',
      resource: 'document-extraction',
      action: 'extract',
    },
  });

  const extractDocumentFromUrlPermission = await prisma.permission.upsert({
    where: { name: 'document-extraction:extract-url' },
    update: {},
    create: {
      name: 'document-extraction:extract-url',
      description: 'Can extract data from document images via URL',
      resource: 'document-extraction',
      action: 'extract-url',
    },
  });

  const readDocumentTypesPermission = await prisma.permission.upsert({
    where: { name: 'document-extraction:read-types' },
    update: {},
    create: {
      name: 'document-extraction:read-types',
      description: 'Can read available document types for extraction',
      resource: 'document-extraction',
      action: 'read-types',
    },
  });

  // Create permissions for documentTemplates
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

  const readOneDocumentTemplatePermission = await prisma.permission.upsert({
    where: { name: 'documentTemplates:read-one' },
    update: {},
    create: {
      name: 'documentTemplates:read-one',
      description: 'Can read one document template',
      resource: 'documentTemplates',
      action: 'read-one',
    },
  });

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

  // Create permissions for inventories
  const readInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventories:read' },
    update: {},
    create: {
      name: 'inventories:read',
      description: 'Can read inventories',
      resource: 'inventories',
      action: 'read',
    },
  });

  const readOneInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventories:read-one' },
    update: {},
    create: {
      name: 'inventories:read-one',
      description: 'Can read one inventory',
      resource: 'inventories',
      action: 'read-one',
    },
  });

  const readInventoryByStatusPermission = await prisma.permission.upsert({
    where: { name: 'inventories:read-by-status' },
    update: {},
    create: {
      name: 'inventories:read-by-status',
      description: 'Can read inventories by status',
      resource: 'inventories',
      action: 'read-by-status',
    },
  });

  const readInventoryBySkuPermission = await prisma.permission.upsert({
    where: { name: 'inventories:read-by-sku' },
    update: {},
    create: {
      name: 'inventories:read-by-sku',
      description: 'Can read inventories by SKU',
      resource: 'inventories',
      action: 'read-by-sku',
    },
  });

  const readInventoryByAssetPermission = await prisma.permission.upsert({
    where: { name: 'inventories:read-by-asset' },
    update: {},
    create: {
      name: 'inventories:read-by-asset',
      description: 'Can read inventories by asset',
      resource: 'inventories',
      action: 'read-by-asset',
    },
  });

  const createInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventories:create' },
    update: {},
    create: {
      name: 'inventories:create',
      description: 'Can create inventories',
      resource: 'inventories',
      action: 'create',
    },
  });

  const updateInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventories:update' },
    update: {},
    create: {
      name: 'inventories:update',
      description: 'Can update inventories',
      resource: 'inventories',
      action: 'update',
    },
  });

  const deleteInventoryPermission = await prisma.permission.upsert({
    where: { name: 'inventories:delete' },
    update: {},
    create: {
      name: 'inventories:delete',
      description: 'Can delete inventories',
      resource: 'inventories',
      action: 'delete',
    },
  });

  const generateSkuPermission = await prisma.permission.upsert({
    where: { name: 'inventories:generate-sku' },
    update: {},
    create: {
      name: 'inventories:generate-sku',
      description: 'Can generate SKU for inventories',
      resource: 'inventories',
      action: 'generate-sku',
    },
  });

  const generateQrcodePermission = await prisma.permission.upsert({
    where: { name: 'inventories:generate-qrcode' },
    update: {},
    create: {
      name: 'inventories:generate-qrcode',
      description: 'Can generate QR code for inventories',
      resource: 'inventories',
      action: 'generate-qrcode',
    },
  });

  const readInventoryByIdsPermission = await prisma.permission.upsert({
    where: { name: 'inventories:read-by-ids' },
    update: {},
    create: {
      name: 'inventories:read-by-ids',
      description: 'Can read inventories by IDs',
      resource: 'inventories',
      action: 'read-by-ids',
    },
  });

  // Create permissions for timeline-items
  const createTimelineItemPermission = await prisma.permission.upsert({
    where: { name: 'timeline-items:create' },
    update: {},
    create: {
      name: 'timeline-items:create',
      description: 'Can create timeline items',
      resource: 'timeline-items',
      action: 'create',
    },
  });

  const readTimelineItemByInventoryPermission = await prisma.permission.upsert({
    where: { name: 'timeline-items:read-by-inventory' },
    update: {},
    create: {
      name: 'timeline-items:read-by-inventory',
      description: 'Can read timeline items by inventory',
      resource: 'timeline-items',
      action: 'read-by-inventory',
    },
  });

  const readTimelineItemByDocumentPermission = await prisma.permission.upsert({
    where: { name: 'timeline-items:read-by-document' },
    update: {},
    create: {
      name: 'timeline-items:read-by-document',
      description: 'Can read timeline items by document',
      resource: 'timeline-items',
      action: 'read-by-document',
    },
  });

  const readOneTimelineItemPermission = await prisma.permission.upsert({
    where: { name: 'timeline-items:read-one' },
    update: {},
    create: {
      name: 'timeline-items:read-one',
      description: 'Can read one timeline item',
      resource: 'timeline-items',
      action: 'read-one',
    },
  });

  const updateTimelineItemPermission = await prisma.permission.upsert({
    where: { name: 'timeline-items:update' },
    update: {},
    create: {
      name: 'timeline-items:update',
      description: 'Can update timeline items',
      resource: 'timeline-items',
      action: 'update',
    },
  });

  const deleteTimelineItemPermission = await prisma.permission.upsert({
    where: { name: 'timeline-items:delete' },
    update: {},
    create: {
      name: 'timeline-items:delete',
      description: 'Can delete timeline items',
      resource: 'timeline-items',
      action: 'delete',
    },
  });

  // Create permissions for projects
  const readOneProjectPermission = await prisma.permission.upsert({
    where: { name: 'projects:read-one' },
    update: {},
    create: {
      name: 'projects:read-one',
      description: 'Can read one project',
      resource: 'projects',
      action: 'read-one',
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

  const createProjectByNamePermission = await prisma.permission.upsert({
    where: { name: 'projects:create-by-name' },
    update: {},
    create: {
      name: 'projects:create-by-name',
      description: 'Can create projects by name',
      resource: 'projects',
      action: 'create-by-name',
    },
  });

  const addProjectAssignmentsPermission = await prisma.permission.upsert({
    where: { name: 'projects:add-assignments' },
    update: {},
    create: {
      name: 'projects:add-assignments',
      description: 'Can add assignments to projects',
      resource: 'projects',
      action: 'add-assignments',
    },
  });

  // Create permissions for uploads
  const uploadImagePermission = await prisma.permission.upsert({
    where: { name: 'uploads:upload-image' },
    update: {},
    create: {
      name: 'uploads:upload-image',
      description: 'Can upload images',
      resource: 'uploads',
      action: 'upload-image',
    },
  });

  // Create audit permissions
  const readAuditPermission = await prisma.permission.upsert({
    where: { name: 'audit:read' },
    update: {},
    create: {
      name: 'audit:read',
      description: 'Can read audit logs',
      resource: 'audit',
      action: 'read',
    },
  });

  // Create additional user permissions
  const createUserPermission = await prisma.permission.upsert({
    where: { name: 'users:create' },
    update: {},
    create: {
      name: 'users:create',
      description: 'Can create users',
      resource: 'users',
      action: 'create',
    },
  });

  const updateUserPermission = await prisma.permission.upsert({
    where: { name: 'users:update' },
    update: {},
    create: {
      name: 'users:update',
      description: 'Can update users',
      resource: 'users',
      action: 'update',
    },
  });

  const readUserPermission = await prisma.permission.upsert({
    where: { name: 'users:read' },
    update: {},
    create: {
      name: 'users:read',
      description: 'Can read users',
      resource: 'users',
      action: 'read',
    },
  });

  const deleteUserPermission = await prisma.permission.upsert({
    where: { name: 'users:delete' },
    update: {},
    create: {
      name: 'users:delete',
      description: 'Can delete users',
      resource: 'users',
      action: 'delete',
    },
  });

  // Create OsirisAdmin role with ALL permissions (platform-level + all business operations)
  const osirisAdminRole = await prisma.role.upsert({
    where: {
      name_organizationId: {
        name: 'osirisadmin',
        organizationId: osirisOrg.id,
      },
    },
    update: {
      permissions: {
        set: [
          // Platform-level permissions (exclusive to OsirisAdmin)
          // Organization management
          { id: readUserOrganizationPermission.id },
          { id: createOrganizationPermission.id },
          { id: readOrganizationPermission.id },
          { id: readOneOrganizationPermission.id },
          { id: updateOrganizationPermission.id },
          { id: deleteOrganizationPermission.id },
          // Role and permission management
          { id: createRolePermission.id },
          { id: readRolePermission.id },
          { id: updateRolePermission.id },
          { id: deleteRolePermission.id },
          { id: createPermissionPermission.id },
          { id: readPermissionPermission.id },
          { id: updatePermissionPermission.id },
          { id: deletePermissionPermission.id },
          // User management
          { id: assignRolePermission.id },
          { id: removeRolePermission.id },
          { id: readRolesPermission.id },
          { id: createUserPermission.id },
          { id: updateUserPermission.id },
          { id: readUserPermission.id },
          { id: deleteUserPermission.id },
          // Audit management
          { id: readAuditPermission.id },

          // Business operations (same as superadmin + can do across all organizations)
          // Asset management
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: createAssetsPermission.id },
          { id: updateAssetsPermission.id },
          { id: deleteAssetsPermission.id },
          { id: checkAssetsSkuPermission.id },
          // Category management
          { id: createCategoryPermission.id },
          { id: readCategoryPermission.id },
          { id: readOneCategoryPermission.id },
          { id: updateCategoryPermission.id },
          { id: deleteCategoryPermission.id },
          // Customer management
          { id: readCustomerPermission.id },
          { id: readOneCustomerPermission.id },
          { id: createCustomerPermission.id },
          { id: updateCustomerPermission.id },
          { id: deleteCustomerPermission.id },
          // Document management
          { id: createDocumentWithTimelinePermission.id },
          { id: createBasicDocumentPermission.id },
          { id: createDocumentRevisionPermission.id },
          { id: readDocumentPermission.id },
          { id: readOneDocumentPermission.id },
          { id: readDocumentByInventoryPermission.id },
          { id: updateDocumentPermission.id },
          { id: deleteDocumentPermission.id },
          { id: readDocumentByAssetPermission.id },
          { id: tagTemplateToAssetPermission.id },
          { id: untagTemplateFromAssetPermission.id },
          { id: sendEmailDocumentPermission.id },
          { id: getPaymentSummaryPermission.id },
          // Document extraction
          { id: extractDocumentPermission.id },
          { id: extractDocumentFromUrlPermission.id },
          { id: readDocumentTypesPermission.id },
          // Document template management
          { id: readDocumentTemplatePermission.id },
          { id: readOneDocumentTemplatePermission.id },
          { id: createDocumentTemplatePermission.id },
          { id: updateDocumentTemplatePermission.id },
          { id: deleteDocumentTemplatePermission.id },
          // Inventory management
          { id: readInventoryPermission.id },
          { id: readOneInventoryPermission.id },
          { id: readInventoryByStatusPermission.id },
          { id: readInventoryBySkuPermission.id },
          { id: readInventoryByAssetPermission.id },
          { id: createInventoryPermission.id },
          { id: updateInventoryPermission.id },
          { id: deleteInventoryPermission.id },
          { id: generateSkuPermission.id },
          { id: generateQrcodePermission.id },
          { id: readInventoryByIdsPermission.id },
          // Timeline management
          { id: createTimelineItemPermission.id },
          { id: readTimelineItemByInventoryPermission.id },
          { id: readTimelineItemByDocumentPermission.id },
          { id: readOneTimelineItemPermission.id },
          { id: updateTimelineItemPermission.id },
          { id: deleteTimelineItemPermission.id },
          // Project management
          { id: readOneProjectPermission.id },
          { id: readProjectPermission.id },
          { id: createProjectPermission.id },
          { id: createProjectByNamePermission.id },
          { id: addProjectAssignmentsPermission.id },
          // File uploads
          { id: uploadImagePermission.id },
        ],
      },
    },
    create: {
      name: 'osirisadmin',
      description: 'Osiris Platform Administrator with ALL permissions (platform + business operations)',
      organizationId: osirisOrg.id,
      permissions: {
        connect: [
          // Platform-level permissions (exclusive to OsirisAdmin)
          // Organization management
          { id: readUserOrganizationPermission.id },
          { id: createOrganizationPermission.id },
          { id: readOrganizationPermission.id },
          { id: readOneOrganizationPermission.id },
          { id: updateOrganizationPermission.id },
          { id: deleteOrganizationPermission.id },
          // Role and permission management
          { id: createRolePermission.id },
          { id: readRolePermission.id },
          { id: updateRolePermission.id },
          { id: deleteRolePermission.id },
          { id: createPermissionPermission.id },
          { id: readPermissionPermission.id },
          { id: updatePermissionPermission.id },
          { id: deletePermissionPermission.id },
          // User management
          { id: assignRolePermission.id },
          { id: removeRolePermission.id },
          { id: readRolesPermission.id },
          { id: createUserPermission.id },
          { id: updateUserPermission.id },
          { id: readUserPermission.id },
          { id: deleteUserPermission.id },
          // Audit management
          { id: readAuditPermission.id },

          // Business operations (same as superadmin + can do across all organizations)
          // Asset management
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: createAssetsPermission.id },
          { id: updateAssetsPermission.id },
          { id: deleteAssetsPermission.id },
          { id: checkAssetsSkuPermission.id },
          // Category management
          { id: createCategoryPermission.id },
          { id: readCategoryPermission.id },
          { id: readOneCategoryPermission.id },
          { id: updateCategoryPermission.id },
          { id: deleteCategoryPermission.id },
          // Customer management
          { id: readCustomerPermission.id },
          { id: readOneCustomerPermission.id },
          { id: createCustomerPermission.id },
          { id: updateCustomerPermission.id },
          { id: deleteCustomerPermission.id },
          // Document management
          { id: createDocumentWithTimelinePermission.id },
          { id: createBasicDocumentPermission.id },
          { id: createDocumentRevisionPermission.id },
          { id: readDocumentPermission.id },
          { id: readOneDocumentPermission.id },
          { id: readDocumentByInventoryPermission.id },
          { id: updateDocumentPermission.id },
          { id: deleteDocumentPermission.id },
          { id: readDocumentByAssetPermission.id },
          { id: tagTemplateToAssetPermission.id },
          { id: untagTemplateFromAssetPermission.id },
          { id: sendEmailDocumentPermission.id },
          { id: getPaymentSummaryPermission.id },
          // Document extraction
          { id: extractDocumentPermission.id },
          { id: extractDocumentFromUrlPermission.id },
          { id: readDocumentTypesPermission.id },
          // Document template management
          { id: readDocumentTemplatePermission.id },
          { id: readOneDocumentTemplatePermission.id },
          { id: createDocumentTemplatePermission.id },
          { id: updateDocumentTemplatePermission.id },
          { id: deleteDocumentTemplatePermission.id },
          // Inventory management
          { id: readInventoryPermission.id },
          { id: readOneInventoryPermission.id },
          { id: readInventoryByStatusPermission.id },
          { id: readInventoryBySkuPermission.id },
          { id: readInventoryByAssetPermission.id },
          { id: createInventoryPermission.id },
          { id: updateInventoryPermission.id },
          { id: deleteInventoryPermission.id },
          { id: generateSkuPermission.id },
          { id: generateQrcodePermission.id },
          { id: readInventoryByIdsPermission.id },
          // Timeline management
          { id: createTimelineItemPermission.id },
          { id: readTimelineItemByInventoryPermission.id },
          { id: readTimelineItemByDocumentPermission.id },
          { id: readOneTimelineItemPermission.id },
          { id: updateTimelineItemPermission.id },
          { id: deleteTimelineItemPermission.id },
          // Project management
          { id: readOneProjectPermission.id },
          { id: readProjectPermission.id },
          { id: createProjectPermission.id },
          { id: createProjectByNamePermission.id },
          { id: addProjectAssignmentsPermission.id },
          // File uploads
          { id: uploadImagePermission.id },
          // Dashboard
          { id: dashboardReadPermission.id },
        ],
      },
    },
  });

  // Create superadmin role with organization-scoped permissions only
  const superadminRole = await prisma.role.upsert({
    where: {
      name_organizationId: {
        name: 'superadmin',
        organizationId: osirisOrg.id,
      },
    },
    update: {
      permissions: {
        set: [
          // Organization management (org-scoped)
          { id: updateOrganizationPermission.id },
          // Asset management (organization-scoped)
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: createAssetsPermission.id },
          { id: updateAssetsPermission.id },
          { id: deleteAssetsPermission.id },
          { id: checkAssetsSkuPermission.id },
          // Category management (organization-scoped)
          { id: createCategoryPermission.id },
          { id: readCategoryPermission.id },
          { id: readOneCategoryPermission.id },
          { id: updateCategoryPermission.id },
          { id: deleteCategoryPermission.id },
          // Customer management (organization-scoped)
          { id: readCustomerPermission.id },
          { id: readOneCustomerPermission.id },
          { id: createCustomerPermission.id },
          { id: updateCustomerPermission.id },
          { id: deleteCustomerPermission.id },
          // Document management (organization-scoped)
          { id: createDocumentWithTimelinePermission.id },
          { id: createBasicDocumentPermission.id },
          { id: createDocumentRevisionPermission.id },
          { id: readDocumentPermission.id },
          { id: readOneDocumentPermission.id },
          { id: readDocumentByInventoryPermission.id },
          { id: updateDocumentPermission.id },
          { id: deleteDocumentPermission.id },
          { id: readDocumentByAssetPermission.id },
          { id: tagTemplateToAssetPermission.id },
          { id: untagTemplateFromAssetPermission.id },
          // Document template management (organization-scoped)
          { id: readDocumentTemplatePermission.id },
          { id: readOneDocumentTemplatePermission.id },
          { id: createDocumentTemplatePermission.id },
          { id: updateDocumentTemplatePermission.id },
          { id: deleteDocumentTemplatePermission.id },
          // Inventory management (organization-scoped)
          { id: readInventoryPermission.id },
          { id: readOneInventoryPermission.id },
          { id: readInventoryByStatusPermission.id },
          { id: readInventoryBySkuPermission.id },
          { id: readInventoryByAssetPermission.id },
          { id: createInventoryPermission.id },
          { id: updateInventoryPermission.id },
          { id: deleteInventoryPermission.id },
          { id: generateSkuPermission.id },
          { id: generateQrcodePermission.id },
          { id: readInventoryByIdsPermission.id },
          // Timeline management (organization-scoped)
          { id: createTimelineItemPermission.id },
          { id: readTimelineItemByInventoryPermission.id },
          { id: readTimelineItemByDocumentPermission.id },
          { id: readOneTimelineItemPermission.id },
          { id: updateTimelineItemPermission.id },
          { id: deleteTimelineItemPermission.id },
          // Project management (organization-scoped)
          { id: readOneProjectPermission.id },
          { id: readProjectPermission.id },
          { id: createProjectPermission.id },
          { id: createProjectByNamePermission.id },
          { id: addProjectAssignmentsPermission.id },
          // File uploads (organization-scoped)
          { id: uploadImagePermission.id },
          // Audit management (organization-scoped)
          { id: readAuditPermission.id },
          // Dashboard (organization-scoped)
          { id: dashboardReadPermission.id },
        ],
      },
    },
    create: {
      name: 'superadmin',
      description: 'Organization Super Administrator with full permissions within their organization',
      organizationId: osirisOrg.id,
      permissions: {
        connect: [
          // Organization management (org-scoped)
          { id: updateOrganizationPermission.id },
          // Asset management (organization-scoped)
          { id: readAssetsPermission.id },
          { id: readAssetsSkuPermission.id },
          { id: readAssetsIdPermission.id },
          { id: createAssetsPermission.id },
          { id: updateAssetsPermission.id },
          { id: deleteAssetsPermission.id },
          { id: checkAssetsSkuPermission.id },
          // Category management (organization-scoped)
          { id: createCategoryPermission.id },
          { id: readCategoryPermission.id },
          { id: readOneCategoryPermission.id },
          { id: updateCategoryPermission.id },
          { id: deleteCategoryPermission.id },
          // Customer management (organization-scoped)
          { id: readCustomerPermission.id },
          { id: readOneCustomerPermission.id },
          { id: createCustomerPermission.id },
          { id: updateCustomerPermission.id },
          { id: deleteCustomerPermission.id },
          // Document management (organization-scoped)
          { id: createDocumentWithTimelinePermission.id },
          { id: createBasicDocumentPermission.id },
          { id: createDocumentRevisionPermission.id },
          { id: readDocumentPermission.id },
          { id: readOneDocumentPermission.id },
          { id: readDocumentByInventoryPermission.id },
          { id: updateDocumentPermission.id },
          { id: deleteDocumentPermission.id },
          { id: readDocumentByAssetPermission.id },
          { id: tagTemplateToAssetPermission.id },
          { id: untagTemplateFromAssetPermission.id },
          // Document template management (organization-scoped)
          { id: readDocumentTemplatePermission.id },
          { id: readOneDocumentTemplatePermission.id },
          { id: createDocumentTemplatePermission.id },
          { id: updateDocumentTemplatePermission.id },
          { id: deleteDocumentTemplatePermission.id },
          // Inventory management (organization-scoped)
          { id: readInventoryPermission.id },
          { id: readOneInventoryPermission.id },
          { id: readInventoryByStatusPermission.id },
          { id: readInventoryBySkuPermission.id },
          { id: readInventoryByAssetPermission.id },
          { id: createInventoryPermission.id },
          { id: updateInventoryPermission.id },
          { id: deleteInventoryPermission.id },
          { id: generateSkuPermission.id },
          { id: generateQrcodePermission.id },
          { id: readInventoryByIdsPermission.id },
          // Timeline management (organization-scoped)
          { id: createTimelineItemPermission.id },
          { id: readTimelineItemByInventoryPermission.id },
          { id: readTimelineItemByDocumentPermission.id },
          { id: readOneTimelineItemPermission.id },
          { id: updateTimelineItemPermission.id },
          { id: deleteTimelineItemPermission.id },
          // Project management (organization-scoped)
          { id: readOneProjectPermission.id },
          { id: readProjectPermission.id },
          { id: createProjectPermission.id },
          { id: createProjectByNamePermission.id },
          { id: addProjectAssignmentsPermission.id },
          // File uploads (organization-scoped)
          { id: uploadImagePermission.id },
          // Audit management (organization-scoped)
          { id: readAuditPermission.id },
          // Dashboard (organization-scoped)
          { id: dashboardReadPermission.id },
        ],
      },
    },
  });

  // Create regular user role with limited permissions
  await prisma.role.upsert({
    where: {
      name_organizationId: {
        name: 'user',
        organizationId: osirisOrg.id,
      },
    },
    update: {
      permissions: {
        set: [{ id: readRolePermission.id }, { id: readPermissionPermission.id }, { id: readRolesPermission.id }, { id: readAuditPermission.id }],
      },
    },
    create: {
      name: 'user',
      description: 'Regular user with limited permissions',
      organizationId: osirisOrg.id,
      permissions: {
        connect: [{ id: readRolePermission.id }, { id: readPermissionPermission.id }, { id: readRolesPermission.id }, { id: readAuditPermission.id }],
      },
    },
  });

  // ===== ACCOUNTING PERMISSIONS =====

  // Payments permissions
  const createPaymentPermission = await prisma.permission.upsert({
    where: { name: 'payments:create' },
    update: {},
    create: {
      name: 'payments:create',
      description: 'Can record payments',
      resource: 'payments',
      action: 'create',
    },
  });

  const readPaymentPermission = await prisma.permission.upsert({
    where: { name: 'payments:read' },
    update: {},
    create: {
      name: 'payments:read',
      description: 'Can view payments',
      resource: 'payments',
      action: 'read',
    },
  });

  const updatePaymentPermission = await prisma.permission.upsert({
    where: { name: 'payments:update' },
    update: {},
    create: {
      name: 'payments:update',
      description: 'Can update payments',
      resource: 'payments',
      action: 'update',
    },
  });

  const deletePaymentPermission = await prisma.permission.upsert({
    where: { name: 'payments:delete' },
    update: {},
    create: {
      name: 'payments:delete',
      description: 'Can delete payments',
      resource: 'payments',
      action: 'delete',
    },
  });

  // Transactions permissions
  const createTransactionPermission = await prisma.permission.upsert({
    where: { name: 'transactions:create' },
    update: {},
    create: {
      name: 'transactions:create',
      description: 'Can create manual transactions (adjustments, opening balances)',
      resource: 'transactions',
      action: 'create',
    },
  });

  const readTransactionPermission = await prisma.permission.upsert({
    where: { name: 'transactions:read' },
    update: {},
    create: {
      name: 'transactions:read',
      description: 'Can view transactions',
      resource: 'transactions',
      action: 'read',
    },
  });

  const updateTransactionPermission = await prisma.permission.upsert({
    where: { name: 'transactions:update' },
    update: {},
    create: {
      name: 'transactions:update',
      description: 'Can update transactions and recalculate balances',
      resource: 'transactions',
      action: 'update',
    },
  });

  const deleteTransactionPermission = await prisma.permission.upsert({
    where: { name: 'transactions:delete' },
    update: {},
    create: {
      name: 'transactions:delete',
      description: 'Can delete manual transactions',
      resource: 'transactions',
      action: 'delete',
    },
  });

  // Statements permissions
  const readStatementPermission = await prisma.permission.upsert({
    where: { name: 'statements:read' },
    update: {},
    create: {
      name: 'statements:read',
      description: 'Can view and generate statements of account',
      resource: 'statements',
      action: 'read',
    },
  });

  // General Ledger / Chart of Accounts / Accounting Setup permissions
  const accountingActions: Array<{ action: string; description: string }> = [
    { action: 'read', description: 'Can view chart of accounts and accounting settings' },
    { action: 'create', description: 'Can create chart-of-account entries' },
    { action: 'update', description: 'Can update chart-of-account entries and accounting settings' },
    { action: 'delete', description: 'Can deactivate chart-of-account entries' },
  ];
  for (const { action, description } of accountingActions) {
    await prisma.permission.upsert({
      where: { name: `accounting:${action}` },
      update: {},
      create: {
        name: `accounting:${action}`,
        description,
        resource: 'accounting',
        action,
      },
    });
  }

  // Journal entries (General Ledger) permissions
  const journalActions: Array<{ action: string; description: string }> = [
    { action: 'read', description: 'Can view journal entries, trial balance, and general ledger' },
    { action: 'create', description: 'Can create manual journal entries' },
    { action: 'post', description: 'Can post journal entries' },
    { action: 'void', description: 'Can void posted journal entries (creates reversing entry)' },
  ];
  for (const { action, description } of journalActions) {
    await prisma.permission.upsert({
      where: { name: `journal:${action}` },
      update: {},
      create: {
        name: `journal:${action}`,
        description,
        resource: 'journal',
        action,
      },
    });
  }

  console.log('✅ Accounting permissions created successfully');
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
