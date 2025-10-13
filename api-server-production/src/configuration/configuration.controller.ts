import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { ConfigurationService } from './configuration.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CreateModuleDto, UpdateModuleDto } from './dto/module.dto';
import { CreateCustomFieldDto, UpdateCustomFieldDto, BulkSetCustomFieldValuesDto } from './dto/custom-field.dto';
import { UpdateUIConfigDto } from './dto/ui-config.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@ApiTags('configuration')
@Controller('configuration')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class ConfigurationController {
  constructor(private readonly configurationService: ConfigurationService) {}

  // ===================== MODULE ENDPOINTS =====================

  @Get('modules')
  @ApiOperation({ summary: 'Get all modules for the organization' })
  @ApiResponse({ status: 200, description: 'List of organization modules' })
  async getModules(@UserOrganization() userOrganization: any) {
    return this.configurationService.getOrganizationModules(userOrganization.id);
  }

  @Post('modules')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Create or update a module configuration' })
  @ApiResponse({ status: 201, description: 'Module created/updated successfully' })
  async createOrUpdateModule(
    @UserOrganization() userOrganization: any,
    @Body() createModuleDto: CreateModuleDto
  ) {
    return this.configurationService.createOrUpdateModule(userOrganization.id, createModuleDto);
  }

  @Put('modules/:moduleCode')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Update a specific module configuration' })
  @ApiResponse({ status: 200, description: 'Module updated successfully' })
  async updateModule(
    @UserOrganization() userOrganization: any,
    @Param('moduleCode') moduleCode: string,
    @Body() updateModuleDto: UpdateModuleDto
  ) {
    return this.configurationService.updateModule(userOrganization.id, moduleCode, updateModuleDto);
  }

  @Delete('modules/:moduleCode')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Delete a module configuration' })
  @ApiResponse({ status: 200, description: 'Module deleted successfully' })
  async deleteModule(
    @UserOrganization() userOrganization: any,
    @Param('moduleCode') moduleCode: string
  ) {
    return this.configurationService.deleteModule(userOrganization.id, moduleCode);
  }

  @Post('modules/initialize')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Initialize default modules for the organization' })
  @ApiResponse({ status: 201, description: 'Default modules initialized successfully' })
  async initializeModules(@UserOrganization() userOrganization: any) {
    return this.configurationService.initializeDefaultModules(userOrganization.id);
  }

  // ===================== CUSTOM FIELDS ENDPOINTS =====================

  @Get('custom-fields')
  @ApiOperation({ summary: 'Get custom fields for the organization' })
  @ApiResponse({ status: 200, description: 'List of custom fields' })
  async getCustomFields(
    @UserOrganization() userOrganization: any,
    @Query('entityType') entityType?: string
  ) {
    return this.configurationService.getCustomFields(userOrganization.id, entityType);
  }

  @Post('custom-fields')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Create a new custom field' })
  @ApiResponse({ status: 201, description: 'Custom field created successfully' })
  async createCustomField(
    @UserOrganization() userOrganization: any,
    @Body() createCustomFieldDto: CreateCustomFieldDto
  ) {
    return this.configurationService.createCustomField(userOrganization.id, createCustomFieldDto);
  }

  @Put('custom-fields/:id')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Update a custom field' })
  @ApiResponse({ status: 200, description: 'Custom field updated successfully' })
  async updateCustomField(
    @Param('id') id: string,
    @Body() updateCustomFieldDto: UpdateCustomFieldDto
  ) {
    return this.configurationService.updateCustomField(id, updateCustomFieldDto);
  }

  @Delete('custom-fields/:id')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Delete a custom field (soft delete)' })
  @ApiResponse({ status: 200, description: 'Custom field deleted successfully' })
  async deleteCustomField(@Param('id') id: string) {
    return this.configurationService.deleteCustomField(id);
  }

  @Get('custom-fields/values/:entityId')
  @ApiOperation({ summary: 'Get custom field values for an entity' })
  @ApiResponse({ status: 200, description: 'Custom field values for the entity' })
  async getCustomFieldValues(
    @Param('entityId') entityId: string,
    @Query('entityType') entityType: string
  ) {
    return this.configurationService.getCustomFieldValues(entityId, entityType);
  }

  @Post('custom-fields/values')
  @ApiOperation({ summary: 'Set custom field values for an entity' })
  @ApiResponse({ status: 201, description: 'Custom field values set successfully' })
  async setCustomFieldValues(@Body() dto: BulkSetCustomFieldValuesDto) {
    return this.configurationService.setCustomFieldValues(
      dto.entityId,
      dto.entityType,
      dto.values
    );
  }

  // ===================== UI CONFIGURATION ENDPOINTS =====================

  @Get('ui')
  @ApiOperation({ summary: 'Get UI configuration for the organization' })
  @ApiResponse({ status: 200, description: 'UI configuration' })
  async getUIConfig(@UserOrganization() userOrganization: any) {
    return this.configurationService.getUIConfig(userOrganization.id);
  }

  @Put('ui')
  @Permissions('configuration:write')
  @ApiOperation({ summary: 'Update UI configuration for the organization' })
  @ApiResponse({ status: 200, description: 'UI configuration updated successfully' })
  async updateUIConfig(
    @UserOrganization() userOrganization: any,
    @Body() updateUIConfigDto: UpdateUIConfigDto
  ) {
    return this.configurationService.updateUIConfig(userOrganization.id, updateUIConfigDto);
  }

  // ===================== COMPLETE CONFIGURATION =====================

  @Get('complete')
  @ApiOperation({ summary: 'Get complete configuration for the organization' })
  @ApiResponse({ status: 200, description: 'Complete organization configuration' })
  async getCompleteConfiguration(@UserOrganization() userOrganization: any) {
    return this.configurationService.getCompleteConfiguration(userOrganization.id);
  }
}