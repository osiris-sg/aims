import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateModuleDto, UpdateModuleDto, ModuleConfigDto } from './dto/module.dto';
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './dto/custom-field.dto';
import { UpdateUIConfigDto } from './dto/ui-config.dto';

@Injectable()
export class ConfigurationService {
  constructor(private prisma: PrismaService) {}

  // ===================== MODULE MANAGEMENT =====================

  async getOrganizationModules(organizationId: string) {
    return this.prisma.organizationModule.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { moduleCode: 'asc' }],
    });
  }

  async createOrUpdateModule(organizationId: string, data: CreateModuleDto) {
    return this.prisma.organizationModule.upsert({
      where: {
        organizationId_moduleCode: {
          organizationId,
          moduleCode: data.moduleCode,
        },
      },
      update: {
        enabled: data.enabled ?? true,
        displayName: data.displayName,
        icon: data.icon,
        sortOrder: data.sortOrder,
        config: data.config,
      },
      create: {
        organizationId,
        moduleCode: data.moduleCode,
        enabled: data.enabled ?? true,
        displayName: data.displayName,
        icon: data.icon,
        sortOrder: data.sortOrder,
        config: data.config,
      },
    });
  }

  async updateModule(organizationId: string, moduleCode: string, data: UpdateModuleDto) {
    return this.prisma.organizationModule.update({
      where: {
        organizationId_moduleCode: {
          organizationId,
          moduleCode,
        },
      },
      data: {
        enabled: data.enabled,
        displayName: data.displayName,
        icon: data.icon,
        sortOrder: data.sortOrder,
        config: data.config,
      },
    });
  }

  async deleteModule(organizationId: string, moduleCode: string) {
    return this.prisma.organizationModule.delete({
      where: {
        organizationId_moduleCode: {
          organizationId,
          moduleCode,
        },
      },
    });
  }

  async initializeDefaultModules(organizationId: string) {
    const defaultModules = [
      { moduleCode: 'DASHBOARD', displayName: 'Dashboard', icon: 'Dashboard', sortOrder: 0, config: { route: '/portal' } },
      { moduleCode: 'INVENTORY', displayName: 'Inventory', icon: 'Inventory', sortOrder: 1, config: { route: '/portal/inventory' } },
      { moduleCode: 'ASSETS', displayName: 'Products', icon: 'AnalyticsRounded', sortOrder: 2, config: { route: '/portal/assets' } },
      { moduleCode: 'CUSTOMERS', displayName: 'Customers', icon: 'PeopleRounded', sortOrder: 3, config: { route: '/portal/customers' } },
      {
        moduleCode: 'SALES',
        displayName: 'Sales',
        icon: 'ShoppingCart',
        sortOrder: 4,
        config: {
          route: '/portal/sales',
          subMenus: [
            { key: 'quotations', label: 'Quotation' },
            { key: 'sales-orders', label: 'Sales Order' },
            { key: 'delivery-orders', label: 'Delivery Order' },
            { key: 'invoices', label: 'Invoice' },
            { key: 'debit-notes', label: 'Debit Note' },
            { key: 'credit-notes', label: 'Credit Note' },
            { key: 'stock-card', label: 'Stock Card' },
          ],
        },
      },
      { moduleCode: 'PROJECTS', displayName: 'Projects', icon: 'AccountTree', sortOrder: 5, config: { route: '/portal/projects' } },
      { moduleCode: 'USER_MANAGEMENT', displayName: 'User Management', icon: 'PeopleRounded', sortOrder: 6, config: { route: '/portal/user-management', subMenus: ['users', 'roles'] } },
      { moduleCode: 'AUDIT', displayName: 'Audit', icon: 'AnalyticsRounded', sortOrder: 7, config: { route: '/portal/audit' } },
    ];

    const modulePromises = defaultModules.map(module =>
      this.createOrUpdateModule(organizationId, module)
    );

    return Promise.all(modulePromises);
  }

  // ===================== CUSTOM FIELDS MANAGEMENT =====================

  async getCustomFields(organizationId: string, entityType?: string) {
    return this.prisma.customField.findMany({
      where: {
        organizationId,
        ...(entityType && { entityType }),
        isActive: true,
      },
      orderBy: [{ groupName: 'asc' }, { sortOrder: 'asc' }, { fieldName: 'asc' }],
    });
  }

  async createCustomField(organizationId: string, data: CreateCustomFieldDto) {
    return this.prisma.customField.create({
      data: {
        organizationId,
        ...data,
      },
    });
  }

  async updateCustomField(id: string, data: UpdateCustomFieldDto) {
    return this.prisma.customField.update({
      where: { id },
      data,
    });
  }

  async deleteCustomField(id: string) {
    // Soft delete by setting isActive to false
    return this.prisma.customField.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getCustomFieldValues(entityId: string, entityType: string) {
    return this.prisma.customFieldValue.findMany({
      where: {
        entityId,
        entityType,
      },
      include: {
        customField: true,
      },
    });
  }

  async setCustomFieldValue(customFieldId: string, entityId: string, entityType: string, value: any) {
    return this.prisma.customFieldValue.upsert({
      where: {
        customFieldId_entityId: {
          customFieldId,
          entityId,
        },
      },
      update: {
        value,
        entityType,
      },
      create: {
        customFieldId,
        entityId,
        entityType,
        value,
      },
    });
  }

  async setCustomFieldValues(entityId: string, entityType: string, values: Record<string, any>) {
    // Get all custom fields for this entity type and organization
    const customFields = await this.getCustomFields(values.organizationId, entityType);

    const promises = customFields
      .filter(field => values[field.fieldName] !== undefined)
      .map(field =>
        this.setCustomFieldValue(field.id, entityId, entityType, values[field.fieldName])
      );

    return Promise.all(promises);
  }

  // ===================== UI CONFIGURATION =====================

  async getUIConfig(organizationId: string) {
    const config = await this.prisma.organizationUIConfig.findUnique({
      where: { organizationId },
    });

    // Return default config if none exists
    if (!config) {
      return this.getDefaultUIConfig();
    }

    return config;
  }

  async updateUIConfig(organizationId: string, data: UpdateUIConfigDto) {
    return this.prisma.organizationUIConfig.upsert({
      where: { organizationId },
      update: data,
      create: {
        organizationId,
        ...data,
      },
    });
  }

  private getDefaultUIConfig() {
    return {
      theme: {
        primaryColor: '#1976d2',
        secondaryColor: '#dc004e',
        mode: 'light',
      },
      terminology: {
        asset: 'Asset',
        inventory: 'Inventory',
        customer: 'Customer',
        document: 'Document',
        project: 'Project',
      },
      dateFormat: 'MM/dd/yyyy',
      timeFormat: '12h',
      currency: 'USD',
      language: 'en',
      features: {
        enableProjects: true,
        enableDocumentAI: true,
        enableXeroIntegration: false,
        enableCustomFields: true,
      },
    };
  }

  // ===================== COMPLETE CONFIGURATION =====================

  async getCompleteConfiguration(organizationId: string) {
    const [modules, uiConfig, customFields] = await Promise.all([
      this.getOrganizationModules(organizationId),
      this.getUIConfig(organizationId),
      this.getCustomFields(organizationId),
    ]);

    // Group custom fields by entity type
    const customFieldsByEntity = customFields.reduce((acc, field) => {
      if (!acc[field.entityType]) {
        acc[field.entityType] = [];
      }
      acc[field.entityType].push(field);
      return acc;
    }, {} as Record<string, typeof customFields>);

    return {
      modules,
      uiConfig,
      customFields: customFieldsByEntity,
    };
  }

  // ===================== ENTITY WITH CUSTOM FIELDS =====================

  async enrichEntityWithCustomFields<T extends { id: string }>(
    entity: T,
    entityType: string
  ): Promise<T & { customFields: Record<string, any> }> {
    const customFieldValues = await this.getCustomFieldValues(entity.id, entityType);

    const customFields = customFieldValues.reduce((acc, fieldValue) => {
      acc[fieldValue.customField.fieldName] = fieldValue.value;
      return acc;
    }, {} as Record<string, any>);

    return {
      ...entity,
      customFields,
    };
  }

  async enrichEntitiesWithCustomFields<T extends { id: string }>(
    entities: T[],
    entityType: string
  ): Promise<(T & { customFields: Record<string, any> })[]> {
    const enrichedPromises = entities.map(entity =>
      this.enrichEntityWithCustomFields(entity, entityType)
    );

    return Promise.all(enrichedPromises);
  }
}