import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateModuleDto, UpdateModuleDto, ModuleConfigDto } from './dto/module.dto';
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './dto/custom-field.dto';
import { UpdateUIConfigDto } from './dto/ui-config.dto';
import { MODULE_CATALOG, getCatalogModule, mergeModulesWithCatalog } from './module-catalog';

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
    // Upsert, not update: a catalog module surfaced via the merge has no stored row
    // until it's first toggled. Falling back to update() would throw for those. Any
    // field the caller omits falls back to the catalog definition on create.
    const catalog = getCatalogModule(moduleCode);
    return this.prisma.organizationModule.upsert({
      where: {
        organizationId_moduleCode: {
          organizationId,
          moduleCode,
        },
      },
      update: {
        enabled: data.enabled,
        displayName: data.displayName,
        icon: data.icon,
        sortOrder: data.sortOrder,
        config: data.config,
      },
      create: {
        organizationId,
        moduleCode,
        enabled: data.enabled ?? catalog?.defaultEnabled ?? true,
        displayName: data.displayName ?? catalog?.displayName,
        icon: data.icon ?? catalog?.icon,
        sortOrder: data.sortOrder ?? catalog?.sortOrder,
        config: data.config ?? catalog?.config,
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
    // Seed straight from the canonical catalog so there's only one list to maintain.
    // Each module is created with its catalog default-enabled value.
    const modulePromises = MODULE_CATALOG.map(module =>
      this.createOrUpdateModule(organizationId, {
        moduleCode: module.moduleCode,
        enabled: module.defaultEnabled,
        displayName: module.displayName,
        icon: module.icon,
        sortOrder: module.sortOrder,
        config: module.config,
      })
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
    let [modules, uiConfig, customFields] = await Promise.all([
      this.getOrganizationModules(organizationId),
      this.getUIConfig(organizationId),
      this.getCustomFields(organizationId),
    ]);

    // Auto-initialize default modules if none exist for this organization
    if (!modules || modules.length === 0) {
      await this.initializeDefaultModules(organizationId);
      modules = await this.getOrganizationModules(organizationId);
    }

    // Conditionally add/remove 'Inventory Items' submenu based on Asset Tracking Mode
    const uiFeatures = (uiConfig as any)?.features || {};
    const isAssetTrackingOn = uiFeatures.enableAssetTrackingMode === true;
    const inventoryModule = modules.find(m => m.moduleCode === 'INVENTORY');
    if (inventoryModule) {
      const config = inventoryModule.config as any;
      const subMenus = config?.subMenus || [];
      const hasListSubmenu = subMenus.some((s: any) => (typeof s === 'string' ? s : s.key) === 'list');

      if (isAssetTrackingOn && !hasListSubmenu) {
        // Add 'Inventory Items' submenu when tracking is ON
        const updatedSubMenus = [
          subMenus[0], // Products (first item)
          { key: 'list', label: 'Inventory Items' },
          ...subMenus.slice(1),
        ];
        await this.prisma.organizationModule.update({
          where: { organizationId_moduleCode: { organizationId, moduleCode: 'INVENTORY' } },
          data: { config: { ...config, subMenus: updatedSubMenus } },
        });
        modules = await this.getOrganizationModules(organizationId);
      } else if (!isAssetTrackingOn && hasListSubmenu) {
        // Remove 'Inventory Items' submenu when tracking is OFF
        const updatedSubMenus = subMenus.filter((s: any) => (typeof s === 'string' ? s : s.key) !== 'list');
        await this.prisma.organizationModule.update({
          where: { organizationId_moduleCode: { organizationId, moduleCode: 'INVENTORY' } },
          data: { config: { ...config, subMenus: updatedSubMenus } },
        });
        modules = await this.getOrganizationModules(organizationId);
      }
    }

    // Overlay the org's stored module rows on the canonical catalog so every org
    // sees every module (new ones appear disabled, ready to toggle). Stored rows
    // win, so per-org enabled/customisations are preserved.
    const mergedModules = mergeModulesWithCatalog(modules);

    // Group custom fields by entity type
    const customFieldsByEntity = customFields.reduce((acc, field) => {
      if (!acc[field.entityType]) {
        acc[field.entityType] = [];
      }
      acc[field.entityType].push(field);
      return acc;
    }, {} as Record<string, typeof customFields>);

    return {
      modules: mergedModules,
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