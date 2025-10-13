import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface InitializeOrgConfigOptions {
  organizationId: string;
  templateType?: 'standard' | 'enterprise' | 'minimal';
  customConfig?: any;
}

export async function initializeOrganizationConfiguration({
  organizationId,
  templateType = 'standard',
  customConfig = {},
}: InitializeOrgConfigOptions) {
  console.log(`Initializing configuration for organization ${organizationId} with template: ${templateType}`);

  try {
    // 1. Initialize default modules based on template
    const defaultModules = getDefaultModules(templateType);

    for (const module of defaultModules) {
      await prisma.organizationModule.upsert({
        where: {
          organizationId_moduleCode: {
            organizationId,
            moduleCode: module.moduleCode,
          },
        },
        update: {
          enabled: module.enabled,
          displayName: module.displayName,
          icon: module.icon,
          sortOrder: module.sortOrder,
          config: module.config,
        },
        create: {
          organizationId,
          ...module,
        },
      });
    }

    console.log(`✅ Initialized ${defaultModules.length} modules`);

    // 2. Initialize UI configuration
    const uiConfig = getDefaultUIConfig(templateType);

    await prisma.organizationUIConfig.upsert({
      where: { organizationId },
      update: { ...uiConfig, ...customConfig.uiConfig },
      create: {
        organizationId,
        ...uiConfig,
        ...customConfig.uiConfig,
      },
    });

    console.log(`✅ Initialized UI configuration`);

    // 3. Initialize custom fields based on template
    const customFields = getDefaultCustomFields(templateType);

    for (const field of customFields) {
      await prisma.customField.create({
        data: {
          organizationId,
          ...field,
        },
      }).catch(() => {
        // Skip if field already exists
      });
    }

    console.log(`✅ Initialized ${customFields.length} custom fields`);

    // 4. Initialize default roles and permissions
    await initializeDefaultRoles(organizationId);

    console.log(`✅ Configuration initialized successfully for organization ${organizationId}`);
  } catch (error) {
    console.error('Error initializing organization configuration:', error);
    throw error;
  }
}

function getDefaultModules(templateType: string) {
  const baseModules = [
    {
      moduleCode: 'DASHBOARD',
      enabled: true,
      displayName: 'Dashboard',
      icon: 'Dashboard',
      sortOrder: 0,
      config: { route: '/portal' },
    },
    {
      moduleCode: 'INVENTORY',
      enabled: true,
      displayName: 'Inventory',
      icon: 'Inventory',
      sortOrder: 1,
      config: { route: '/portal/inventory' },
    },
    {
      moduleCode: 'ASSETS',
      enabled: true,
      displayName: 'Assets',
      icon: 'AnalyticsRounded',
      sortOrder: 2,
      config: { route: '/portal/assets' },
    },
    {
      moduleCode: 'CUSTOMERS',
      enabled: true,
      displayName: 'Customers',
      icon: 'PeopleRounded',
      sortOrder: 3,
      config: { route: '/portal/customers' },
    },
  ];

  const standardModules = [
    ...baseModules,
    {
      moduleCode: 'DOCUMENTS',
      enabled: true,
      displayName: 'Documents',
      icon: 'Description',
      sortOrder: 4,
      config: {
        route: '/portal/documents',
        subMenus: ['templates', 'extraction'],
      },
    },
    {
      moduleCode: 'INVOICES',
      enabled: true,
      displayName: 'Invoices',
      icon: 'AssignmentRounded',
      sortOrder: 5,
      config: { route: '/portal/invoices' },
    },
    {
      moduleCode: 'PROJECTS',
      enabled: true,
      displayName: 'Projects',
      icon: 'AccountTree',
      sortOrder: 6,
      config: { route: '/portal/projects' },
    },
    {
      moduleCode: 'USER_MANAGEMENT',
      enabled: true,
      displayName: 'User Management',
      icon: 'PeopleRounded',
      sortOrder: 7,
      config: {
        route: '/portal/user-management',
        subMenus: ['users', 'roles'],
      },
    },
    {
      moduleCode: 'AUDIT',
      enabled: true,
      displayName: 'Audit',
      icon: 'AnalyticsRounded',
      sortOrder: 8,
      config: { route: '/portal/audit' },
    },
  ];

  const enterpriseModules = [
    ...standardModules,
    {
      moduleCode: 'ANALYTICS',
      enabled: true,
      displayName: 'Analytics',
      icon: 'Analytics',
      sortOrder: 9,
      config: { route: '/portal/analytics' },
    },
    {
      moduleCode: 'INTEGRATIONS',
      enabled: true,
      displayName: 'Integrations',
      icon: 'Extension',
      sortOrder: 10,
      config: { route: '/portal/integrations' },
    },
  ];

  switch (templateType) {
    case 'enterprise':
      return enterpriseModules;
    case 'minimal':
      return baseModules;
    case 'standard':
    default:
      return standardModules;
  }
}

function getDefaultUIConfig(templateType: string) {
  const baseConfig = {
    theme: {
      primaryColor: '#1976d2',
      secondaryColor: '#dc004e',
      mode: 'light' as const,
      fontSize: 'medium' as const,
      borderRadius: 4,
    },
    dateFormat: 'MM/dd/yyyy',
    timeFormat: '12h',
    currency: 'USD',
    language: 'en',
  };

  switch (templateType) {
    case 'enterprise':
      return {
        ...baseConfig,
        features: {
          enableProjects: true,
          enableDocumentAI: true,
          enableXeroIntegration: true,
          enableCustomFields: true,
          enableAdvancedReporting: true,
          enableAPIAccess: true,
        },
        terminology: {
          asset: 'Asset',
          inventory: 'Inventory',
          customer: 'Customer',
          document: 'Document',
          project: 'Project',
          invoice: 'Invoice',
        },
      };

    case 'minimal':
      return {
        ...baseConfig,
        features: {
          enableProjects: false,
          enableDocumentAI: false,
          enableXeroIntegration: false,
          enableCustomFields: true,
          enableAdvancedReporting: false,
          enableAPIAccess: false,
        },
      };

    case 'standard':
    default:
      return {
        ...baseConfig,
        features: {
          enableProjects: true,
          enableDocumentAI: true,
          enableXeroIntegration: false,
          enableCustomFields: true,
          enableAdvancedReporting: false,
          enableAPIAccess: false,
        },
        terminology: {
          asset: 'Asset',
          inventory: 'Inventory',
          customer: 'Customer',
          document: 'Document',
          project: 'Project',
          invoice: 'Invoice',
        },
      };
  }
}

function getDefaultCustomFields(templateType: string) {
  const baseFields = [
    // Asset custom fields
    {
      entityType: 'Asset',
      fieldName: 'serial_number',
      displayLabel: 'Serial Number',
      fieldType: 'text',
      required: false,
      showInList: true,
      showInForm: true,
      groupName: 'Identification',
      sortOrder: 1,
    },
    {
      entityType: 'Asset',
      fieldName: 'purchase_date',
      displayLabel: 'Purchase Date',
      fieldType: 'date',
      required: false,
      showInList: false,
      showInForm: true,
      groupName: 'Purchase Information',
      sortOrder: 2,
    },
    // Customer custom fields
    {
      entityType: 'Customer',
      fieldName: 'company_type',
      displayLabel: 'Company Type',
      fieldType: 'select',
      required: false,
      showInList: true,
      showInForm: true,
      groupName: 'Company Information',
      sortOrder: 1,
      options: [
        { value: 'corporation', label: 'Corporation' },
        { value: 'llc', label: 'LLC' },
        { value: 'partnership', label: 'Partnership' },
        { value: 'sole_proprietor', label: 'Sole Proprietor' },
      ],
    },
  ];

  const standardFields = [
    ...baseFields,
    // Additional Asset fields
    {
      entityType: 'Asset',
      fieldName: 'warranty_expiry',
      displayLabel: 'Warranty Expiry Date',
      fieldType: 'date',
      required: false,
      showInList: false,
      showInForm: true,
      groupName: 'Warranty',
      sortOrder: 3,
    },
    {
      entityType: 'Asset',
      fieldName: 'supplier',
      displayLabel: 'Supplier',
      fieldType: 'text',
      required: false,
      showInList: false,
      showInForm: true,
      groupName: 'Purchase Information',
      sortOrder: 4,
    },
    // Project custom fields
    {
      entityType: 'Project',
      fieldName: 'project_manager',
      displayLabel: 'Project Manager',
      fieldType: 'text',
      required: false,
      showInList: true,
      showInForm: true,
      groupName: 'Management',
      sortOrder: 1,
    },
    {
      entityType: 'Project',
      fieldName: 'budget',
      displayLabel: 'Budget',
      fieldType: 'number',
      required: false,
      showInList: false,
      showInForm: true,
      groupName: 'Financial',
      sortOrder: 2,
      validation: { min: 0 },
    },
  ];

  const enterpriseFields = [
    ...standardFields,
    // Advanced Asset tracking
    {
      entityType: 'Asset',
      fieldName: 'maintenance_schedule',
      displayLabel: 'Maintenance Schedule',
      fieldType: 'select',
      required: false,
      showInList: false,
      showInForm: true,
      groupName: 'Maintenance',
      sortOrder: 5,
      options: [
        { value: 'monthly', label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
        { value: 'biannual', label: 'Bi-Annual' },
        { value: 'annual', label: 'Annual' },
      ],
    },
    {
      entityType: 'Asset',
      fieldName: 'compliance_status',
      displayLabel: 'Compliance Status',
      fieldType: 'select',
      required: false,
      showInList: true,
      showInForm: true,
      groupName: 'Compliance',
      sortOrder: 6,
      options: [
        { value: 'compliant', label: 'Compliant' },
        { value: 'pending_review', label: 'Pending Review' },
        { value: 'non_compliant', label: 'Non-Compliant' },
      ],
    },
    // Advanced Customer fields
    {
      entityType: 'Customer',
      fieldName: 'credit_limit',
      displayLabel: 'Credit Limit',
      fieldType: 'number',
      required: false,
      showInList: false,
      showInForm: true,
      groupName: 'Financial',
      sortOrder: 2,
      validation: { min: 0 },
    },
    {
      entityType: 'Customer',
      fieldName: 'payment_terms',
      displayLabel: 'Payment Terms',
      fieldType: 'select',
      required: false,
      showInList: false,
      showInForm: true,
      groupName: 'Financial',
      sortOrder: 3,
      options: [
        { value: 'net_30', label: 'Net 30' },
        { value: 'net_60', label: 'Net 60' },
        { value: 'net_90', label: 'Net 90' },
        { value: 'due_on_receipt', label: 'Due on Receipt' },
      ],
    },
  ];

  switch (templateType) {
    case 'enterprise':
      return enterpriseFields;
    case 'minimal':
      return baseFields.slice(0, 2); // Just a few basic fields
    case 'standard':
    default:
      return standardFields;
  }
}

async function initializeDefaultRoles(organizationId: string) {
  const defaultRoles = [
    {
      name: 'Admin',
      description: 'Full access to all modules and configuration',
      permissions: ['*'],
    },
    {
      name: 'Manager',
      description: 'Access to manage assets, inventory, and documents',
      permissions: [
        'assets:read',
        'assets:write',
        'inventory:read',
        'inventory:write',
        'documents:read',
        'documents:write',
        'customers:read',
        'customers:write',
      ],
    },
    {
      name: 'User',
      description: 'Basic read access to most modules',
      permissions: [
        'assets:read',
        'inventory:read',
        'documents:read',
        'customers:read',
      ],
    },
  ];

  for (const roleData of defaultRoles) {
    const role = await prisma.role.upsert({
      where: {
        name_organizationId: {
          name: roleData.name,
          organizationId,
        },
      },
      update: {},
      create: {
        name: roleData.name,
        description: roleData.description,
        organizationId,
      },
    });

    console.log(`✅ Created/Updated role: ${role.name}`);
  }
}

// Script entry point for CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const organizationId = args[0];
  const templateType = (args[1] as 'standard' | 'enterprise' | 'minimal') || 'standard';

  if (!organizationId) {
    console.error('Usage: ts-node initialize-organization-config.ts <organizationId> [templateType]');
    console.error('Template types: standard (default), enterprise, minimal');
    process.exit(1);
  }

  initializeOrganizationConfiguration({ organizationId, templateType })
    .then(() => {
      console.log('✅ Configuration initialization complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Configuration initialization failed:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}