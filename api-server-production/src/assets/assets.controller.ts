import { Controller, Post, Body, Put, Delete, Param, Get, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { GetAssetDto } from './dto/get-assets.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { DeleteAssetDto } from './dto/delete-asset.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';

import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';

@ApiTags('assets')
@UseGuards(ClerkAuthGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get assets based on provided criteria' })
  @ApiBody({ type: GetAssetDto })
  @ApiResponse({ status: 200, description: 'List of assets matching the criteria.' })
  async getAssets(@Body() getAssetDto: GetAssetDto, @UserOrganization() userOrganization: any) {
    return this.assetsService.getAssets(getAssetDto, userOrganization.id);
  }

  @Get('skuKey/:skuKey')
  @Permissions('assets:read-sku')
  @ApiOperation({ summary: 'Get an asset by its SKU Key' })
  @ApiParam({ name: 'skuKey', type: 'string', description: 'The SKU Key of the asset' })
  @ApiResponse({ status: 200, description: 'The asset with the given SKU Key.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async getAssetBySKUKEY(@Param('skuKey') skuKey: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.getAssetBySKUKEY(skuKey, userOrganization.id);
  }

  @Get(':id')
  @Permissions('assets:read-id')
  @ApiOperation({ summary: 'Get an asset by its ID' })
  @ApiParam({ name: 'id', type: 'string', description: 'The ID of the asset' })
  @ApiResponse({ status: 200, description: 'The asset with the given ID.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async getAssetByID(@Param('id') id: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.getAssetById(id, userOrganization.id);
  }

  @Post('create')
  @Permissions('assets:create')
  @ApiOperation({ summary: 'Create a new asset' })
  @ApiBody({ type: CreateAssetDto })
  @ApiResponse({ status: 201, description: 'The asset has been successfully created.' })
  @ApiResponse({ status: 400, description: 'Invalid input.' })
  async createAssets(@Body() createAssetDto: CreateAssetDto, @UserOrganization() userOrganization: any) {
    return this.assetsService.createAssets(createAssetDto, userOrganization.id);
  }

  @Put('update')
  @Permissions('assets:update')
  @ApiOperation({ summary: 'Update an existing asset' })
  @ApiBody({ type: UpdateAssetDto })
  @ApiResponse({ status: 200, description: 'The asset has been successfully updated.' })
  @ApiResponse({ status: 400, description: 'Invalid input.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async updateAssets(@Body() updateAssetDto: UpdateAssetDto, @UserOrganization() userOrganization: any) {
    return this.assetsService.updateAssets(updateAssetDto, userOrganization.id);
  }

  @Delete('delete')
  @Permissions('assets:delete')
  @ApiOperation({ summary: 'Delete an asset' })
  @ApiBody({ type: DeleteAssetDto })
  @ApiResponse({ status: 200, description: 'The asset has been successfully deleted.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async deleteAssets(@Body() deleteAssetDto: DeleteAssetDto, @UserOrganization() userOrganization: any) {
    return this.assetsService.deleteAssets(deleteAssetDto, userOrganization.id);
  }

  @Get('check-skuKey/:skuKey')
  @Permissions('assets:check-sku')
  @ApiOperation({ summary: 'Check if an SKU Key exists' })
  @ApiParam({ name: 'skuKey', type: 'string', description: 'The SKU Key to check' })
  @ApiResponse({ status: 200, description: 'Indicates if the SKU Key exists (true/false).', type: Boolean })
  async checkSkuKey(@Param('skuKey') skuKey: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.checkSkuKey(skuKey, userOrganization.id);
  }
}
