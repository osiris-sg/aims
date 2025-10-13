#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';
import { initializeOrganizationConfiguration } from './initialize-organization-config';

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

interface ClientOnboardingData {
  organizationName: string;
  address?: string;
  phoneNumber?: string;
  registrationNumber?: string;
  templateType: 'standard' | 'enterprise' | 'minimal';
  customization: {
    primaryColor?: string;
    terminology?: {
      asset?: string;
      inventory?: string;
      customer?: string;
      document?: string;
      project?: string;
      invoice?: string;
    };
    enabledModules?: string[];
    disabledModules?: string[];
    customDocumentTypes?: Record<string, string>;
  };
  adminUser?: {
    userId: string;
    email: string;
  };
}

async function onboardClient() {
  console.log('\n🚀 AIMS Client Onboarding Wizard\n');
  console.log('This wizard will help you set up a new client organization with custom configuration.\n');

  try {
    // Collect organization information
    const organizationName = await question('Organization Name (required): ');
    if (!organizationName) {
      throw new Error('Organization name is required');
    }

    const address = await question('Organization Address (optional): ');
    const phoneNumber = await question('Phone Number (optional): ');
    const registrationNumber = await question('Registration Number (optional): ');

    // Select template type
    console.log('\n📋 Template Selection');
    console.log('1. Standard - Full features for most businesses');
    console.log('2. Enterprise - Advanced features with analytics and integrations');
    console.log('3. Minimal - Basic features only\n');

    const templateChoice = await question('Select template (1/2/3) [default: 1]: ');
    const templateMap: Record<string, 'standard' | 'enterprise' | 'minimal'> = {
      '1': 'standard',
      '2': 'enterprise',
      '3': 'minimal',
      '': 'standard',
    };
    const templateType = templateMap[templateChoice] || 'standard';

    // Customization options
    console.log('\n🎨 Customization Options');

    const customizeTerminology = await question('Customize terminology? (y/n) [default: n]: ');
    let terminology: Record<string, string> = {};

    if (customizeTerminology.toLowerCase() === 'y') {
      console.log('\nEnter custom terms (press Enter to keep default):');
      const assetTerm = await question('  Asset [Asset]: ');
      const inventoryTerm = await question('  Inventory [Inventory]: ');
      const customerTerm = await question('  Customer [Customer]: ');
      const documentTerm = await question('  Document [Document]: ');
      const projectTerm = await question('  Project [Project]: ');
      const invoiceTerm = await question('  Invoice [Invoice]: ');

      if (assetTerm) terminology.asset = assetTerm;
      if (inventoryTerm) terminology.inventory = inventoryTerm;
      if (customerTerm) terminology.customer = customerTerm;
      if (documentTerm) terminology.document = documentTerm;
      if (projectTerm) terminology.project = projectTerm;
      if (invoiceTerm) terminology.invoice = invoiceTerm;
    }

    const customizeColors = await question('\nCustomize brand colors? (y/n) [default: n]: ');
    let primaryColor = '#1976d2';

    if (customizeColors.toLowerCase() === 'y') {
      const color = await question('  Primary Color (hex) [#1976d2]: ');
      if (color) primaryColor = color;
    }

    const customizeDocTypes = await question('\nCustomize document type names? (y/n) [default: n]: ');
    let customDocumentTypes: Record<string, string> = {};

    if (customizeDocTypes.toLowerCase() === 'y') {
      console.log('\nEnter custom document type names (press Enter to keep default):');
      const tiName = await question('  Tax Invoice (TI) [Tax Invoice]: ');
      const qo1Name = await question('  Quotation 1 (QO1) [Quotation 1]: ');
      const doName = await question('  Delivery Order (DO) [Delivery Order]: ');
      const rdoName = await question('  Return Delivery Order (RDO) [Return Delivery Order]: ');
      const msrName = await question('  Maintenance Service Report (MSR) [Maintenance Service Report]: ');

      if (tiName) customDocumentTypes.TI = tiName;
      if (qo1Name) customDocumentTypes.QO1 = qo1Name;
      if (doName) customDocumentTypes.DO = doName;
      if (rdoName) customDocumentTypes.RDO = rdoName;
      if (msrName) customDocumentTypes.MSR = msrName;
    }

    // Admin user setup
    console.log('\n👤 Admin User Setup (optional)');
    const setupAdmin = await question('Set up admin user? (y/n) [default: n]: ');
    let adminUser;

    if (setupAdmin.toLowerCase() === 'y') {
      const userId = await question('  Clerk User ID: ');
      const email = await question('  Email: ');
      if (userId && email) {
        adminUser = { userId, email };
      }
    }

    // Confirmation
    console.log('\n📊 Configuration Summary:');
    console.log('========================');
    console.log(`Organization: ${organizationName}`);
    console.log(`Template: ${templateType}`);
    if (Object.keys(terminology).length > 0) {
      console.log(`Custom Terminology: ${JSON.stringify(terminology)}`);
    }
    if (primaryColor !== '#1976d2') {
      console.log(`Primary Color: ${primaryColor}`);
    }
    if (Object.keys(customDocumentTypes).length > 0) {
      console.log(`Custom Document Types: ${JSON.stringify(customDocumentTypes)}`);
    }
    console.log('========================\n');

    const confirm = await question('Proceed with onboarding? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('❌ Onboarding cancelled');
      return;
    }

    // Create the organization
    console.log('\n🏢 Creating organization...');
    const organization = await prisma.organization.create({
      data: {
        name: organizationName,
        address: address || null,
        phoneNumber: phoneNumber || null,
        registrationNumber: registrationNumber || null,
        customDocumentTypes: Object.keys(customDocumentTypes).length > 0 ? customDocumentTypes : null,
      },
    });
    console.log(`✅ Organization created with ID: ${organization.id}`);

    // Initialize configuration
    console.log('\n⚙️  Initializing configuration...');
    await initializeOrganizationConfiguration({
      organizationId: organization.id,
      templateType,
      customConfig: {
        uiConfig: {
          theme: { primaryColor },
          terminology: Object.keys(terminology).length > 0 ? terminology : undefined,
        },
      },
    });

    // Set up admin user if provided
    if (adminUser) {
      console.log('\n👤 Setting up admin user...');

      // Add user to organization
      await prisma.userOrganization.create({
        data: {
          userId: adminUser.userId,
          organizationId: organization.id,
          isActive: true,
        },
      });

      // Assign admin role
      const adminRole = await prisma.role.findFirst({
        where: {
          organizationId: organization.id,
          name: 'Admin',
        },
      });

      if (adminRole) {
        await prisma.userRole.create({
          data: {
            userId: adminUser.userId,
            roleId: adminRole.id,
            organizationId: organization.id,
          },
        });
        console.log(`✅ Admin user ${adminUser.email} added to organization`);
      }
    }

    // Generate summary report
    console.log('\n🎉 Client Onboarding Complete!\n');
    console.log('=================================');
    console.log('ORGANIZATION DETAILS:');
    console.log(`  ID: ${organization.id}`);
    console.log(`  Name: ${organization.name}`);
    console.log(`  Template: ${templateType}`);
    console.log('\nNEXT STEPS:');
    console.log('1. Share the organization ID with the client');
    console.log('2. Client admins can log in and access the configuration page at:');
    console.log('   /portal/admin/configuration');
    console.log('3. They can further customize modules, fields, and UI settings');
    console.log('=================================\n');

    // Create a summary file
    const summary = {
      organizationId: organization.id,
      organizationName: organization.name,
      templateType,
      createdAt: new Date().toISOString(),
      configuration: {
        customTerminology: terminology,
        primaryColor,
        customDocumentTypes,
      },
      adminUser,
    };

    const fs = require('fs');
    const summaryFileName = `onboarding-${organization.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`;
    fs.writeFileSync(summaryFileName, JSON.stringify(summary, null, 2));
    console.log(`📄 Summary saved to: ${summaryFileName}\n`);

  } catch (error) {
    console.error('\n❌ Onboarding failed:', error);
    process.exit(1);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

// Run the onboarding wizard
onboardClient().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});