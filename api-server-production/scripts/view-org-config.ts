#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function viewOrganizationConfig(orgId?: string) {
  try {
    const organizations = orgId
      ? await prisma.organization.findMany({ where: { id: orgId } })
      : await prisma.organization.findMany({ orderBy: { createdAt: 'asc' } });

    for (const org of organizations) {
      console.log('\n' + '='.repeat(80));
      console.log(`📁 ORGANIZATION: ${org.name}`);
      console.log(`   ID: ${org.id}`);
      console.log('='.repeat(80));

      // Modules
      const modules = await prisma.organizationModule.findMany({
        where: { organizationId: org.id },
        orderBy: { sortOrder: 'asc' }
      });

      console.log('\n📋 MODULES:');
      for (const module of modules) {
        const status = module.enabled ? '✅' : '❌';
        const config = module.config as any;
        const route = config?.route || 'N/A';
        console.log(`   ${status} ${module.displayName} (${module.moduleCode}) - Route: ${route}`);
      }

      // Custom Fields
      const customFields = await prisma.customField.findMany({
        where: { organizationId: org.id },
        orderBy: [{ entityType: 'asc' }, { sortOrder: 'asc' }]
      });

      const fieldsByEntity = customFields.reduce((acc, field) => {
        if (!acc[field.entityType]) acc[field.entityType] = [];
        acc[field.entityType].push(field);
        return acc;
      }, {} as Record<string, typeof customFields>);

      console.log('\n🔧 CUSTOM FIELDS:');
      for (const [entityType, fields] of Object.entries(fieldsByEntity)) {
        console.log(`   ${entityType}:`);
        for (const field of fields) {
          const required = field.required ? '(required)' : '(optional)';
          console.log(`     - ${field.displayLabel} [${field.fieldType}] ${required}`);
        }
      }

      // UI Configuration
      const uiConfig = await prisma.organizationUIConfig.findUnique({
        where: { organizationId: org.id }
      });

      if (uiConfig) {
        console.log('\n🎨 UI CONFIGURATION:');
        console.log(`   Theme:`);
        const theme = uiConfig.theme as any;
        if (theme) {
          console.log(`     - Primary Color: ${theme.primaryColor || 'Default'}`);
          console.log(`     - Mode: ${theme.mode || 'light'}`);
        }

        console.log(`   Localization:`);
        console.log(`     - Date Format: ${uiConfig.dateFormat}`);
        console.log(`     - Currency: ${uiConfig.currency}`);
        console.log(`     - Language: ${uiConfig.language}`);

        const features = uiConfig.features as any;
        if (features && Object.keys(features).length > 0) {
          console.log(`   Features:`);
          for (const [feature, enabled] of Object.entries(features)) {
            console.log(`     - ${feature}: ${enabled ? '✅' : '❌'}`);
          }
        }

        const terminology = uiConfig.terminology as any;
        if (terminology && Object.keys(terminology).length > 0) {
          console.log(`   Custom Terminology:`);
          for (const [term, custom] of Object.entries(terminology)) {
            if (custom) {
              console.log(`     - ${term}: "${custom}"`);
            }
          }
        }
      }

      // Roles
      const roles = await prisma.role.findMany({
        where: { organizationId: org.id },
        orderBy: { name: 'asc' }
      });

      console.log('\n👥 ROLES:');
      for (const role of roles) {
        console.log(`   - ${role.name}: ${role.description || 'No description'}`);
      }
    }

    console.log('\n' + '='.repeat(80) + '\n');

  } catch (error) {
    console.error('Error viewing configuration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  const orgId = process.argv[2];
  viewOrganizationConfig(orgId)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}