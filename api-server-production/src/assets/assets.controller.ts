import { Controller, Post, Body, Put, Delete, Param, Get, UseGuards, Req, Query } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { GetAssetDto } from './dto/get-assets.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { DeleteAssetDto } from './dto/delete-asset.dto';
import { UpdateAssetParentDto } from './dto/update-asset-parent.dto';
import { AdjustQuantityDto } from './dto/adjust-quantity.dto';
import { CreateAndBindDto, ExtractLabelDto } from './dto/create-and-bind.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';

import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';
import { WithCustomFields } from '../common/decorators/with-custom-fields.decorator';

@ApiTags('assets')
@UseGuards(ClerkAuthGuard)
@WithCustomFields() // Apply custom fields handling to all endpoints
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

  @Get('hierarchy')
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get assets in hierarchical structure' })
  @ApiResponse({ status: 200, description: 'List of root assets with their complete hierarchy.' })
  async getAssetsHierarchy(@UserOrganization() userOrganization: any) {
    return this.assetsService.getAssetsHierarchy(userOrganization.id);
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

  // NestJS matches routes in declaration order, and `:id` is a catch-all that
  // swallows `/assets/search`. Keep all static-string GET routes ABOVE the
  // parameterized `:id` ones in this file.
  @Get('search')
  @Permissions('assets:bind-nfc-tag')
  @ApiOperation({ summary: 'Lightweight asset search for the field-scan bind picker. Returns up to 50 {id,name,skuKey} matching the query.' })
  @ApiQuery({ name: 'q', type: 'string', required: false, description: 'Case-insensitive substring on name or skuKey.' })
  async searchForFieldPicker(@Query('q') q: string | undefined, @UserOrganization() userOrganization: any) {
    return this.assetsService.searchForFieldPicker(q, userOrganization.id);
  }

  // Manual-entry asset list for the field scan home: assets whose units are
  // reached by keyed-in serial instead of an NFC tap.
  //   default        → only allowManualEntry=true assets (tapping required for
  //                     everything else — NFC-capable devices).
  //   ?all=true      → every tracked asset with ≥1 unit in the org, for devices
  //                     with no NFC where manual entry is the ONLY path in.
  // NOTE: `all` is a client-side device-capability signal, not an authorization
  // boundary — the server can't reliably tell an iPhone from an Android, so this
  // is a UX nudge, not a lock. See the /scan/manual page.
  @Get('manual-entry')
  @Permissions('field-scan:access')
  @ApiOperation({ summary: "Assets for the field serial-entry picker ({id,name,skuKey}). ?all=true widens to all tracked assets with units (no-NFC devices)." })
  @ApiQuery({ name: 'all', type: 'boolean', required: false, description: 'When true, return all tracked assets with ≥1 unit instead of only allowManualEntry ones.' })
  async getManualEntryAssets(@Query('all') all: string | undefined, @UserOrganization() userOrganization: any) {
    return this.assetsService.getManualEntryAssets(userOrganization.id, all === 'true');
  }

  // Photo→serial for the field manual-entry page: same nameplate extraction as
  // POST /assets/extract-label, but guarded by field-scan:access (the field
  // flow's permission) instead of the bind permission. Reuses the identical
  // extractLabel service call — no separate extraction logic.
  @Post('manual-entry/extract-label')
  @Permissions('field-scan:access')
  @ApiOperation({ summary: 'Field manual-entry: extract model + serial from a nameplate photo (base64) via Claude vision.' })
  @ApiBody({ type: ExtractLabelDto })
  async extractLabelForField(@Body() body: ExtractLabelDto) {
    return this.assetsService.extractLabel(body.image);
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

  @Get('by-nfc-uid/:uid')
  @Permissions('field-scan:access')
  @ApiOperation({ summary: 'Resolve an NFC tag UID to the inventory unit + its parent asset. 404 if unbound. Returns { inventory, asset }.' })
  async getByNfcUid(@Param('uid') uid: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.getByNfcUid(uid, userOrganization.id);
  }

  @Post(':id/bind-nfc-tag')
  @Permissions('assets:bind-nfc-tag')
  @ApiOperation({ summary: 'Bind an NFC tag (chip UID) to this asset. Idempotent if same UID; conflicts if UID already used.' })
  async bindNfcTag(
    @Param('id') assetId: string,
    @Body() body: { uid: string },
    @UserOrganization() userOrganization: any,
  ) {
    return this.assetsService.bindNfcTag(assetId, body.uid, userOrganization.id);
  }

  @Post('extract-label')
  @Permissions('assets:bind-nfc-tag')
  @ApiOperation({ summary: 'Extract model + serial from a nameplate photo (base64 JPEG/PNG) using Claude vision.' })
  @ApiBody({ type: ExtractLabelDto })
  async extractLabel(@Body() body: ExtractLabelDto) {
    return this.assetsService.extractLabel(body.image);
  }

  @Post('create-and-bind')
  @Permissions('assets:bind-nfc-tag')
  @ApiOperation({ summary: 'Create a new asset and bind it to an NFC tag in a single step (field create-and-bind flow).' })
  @ApiBody({ type: CreateAndBindDto })
  async createAndBind(@Body() body: CreateAndBindDto, @UserOrganization() userOrganization: any) {
    return this.assetsService.createAndBind(body, userOrganization.id);
  }

  @Get(':id/parts') 
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get all parts of a specific asset' })
  @ApiParam({ name: 'id', type: 'string', description: 'The ID of the parent asset' })
  @ApiResponse({ status: 200, description: 'List of parts belonging to the asset.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async getAssetParts(@Param('id') assetId: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.getAssetParts(assetId, userOrganization.id);
  }

  @Put('parent')
  @Permissions('assets:update')
  @ApiOperation({ summary: 'Update the parent-child relationship of an asset' })
  @ApiBody({ type: UpdateAssetParentDto })
  @ApiResponse({ status: 200, description: 'The asset parent relationship has been successfully updated.' })
  @ApiResponse({ status: 400, description: 'Invalid input or circular reference.' })
  @ApiResponse({ status: 404, description: 'Asset or parent asset not found.' })
  async updateAssetParent(@Body() updateAssetParentDto: UpdateAssetParentDto, @UserOrganization() userOrganization: any) {
    const { assetId, parentAssetId } = updateAssetParentDto;
    return this.assetsService.updateAssetParent(assetId, parentAssetId, userOrganization.id);
  }

  @Get(':id/ancestors')
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get all ancestors (parent chain) of an asset' })
  @ApiParam({ name: 'id', type: 'string', description: 'The ID of the asset' })
  @ApiResponse({ status: 200, description: 'List of ancestors from root to immediate parent.' })
  async getAssetAncestors(@Param('id') assetId: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.getAssetAncestors(assetId, userOrganization.id);
  }

  @Get(':id/descendants')
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get all descendants (all child assets) of an asset' })
  @ApiParam({ name: 'id', type: 'string', description: 'The ID of the asset' })
  @ApiResponse({ status: 200, description: 'List of all descendant assets.' })
  async getAssetDescendants(@Param('id') assetId: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.getAssetDescendants(assetId, userOrganization.id);
  }

  @Get(':id/can-switch-mode')
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Check if an asset can switch tracking mode' })
  @ApiParam({ name: 'id', type: 'string', description: 'The ID of the asset' })
  @ApiResponse({ status: 200, description: 'Returns whether mode switching is allowed and the reason if not.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async canSwitchTrackingMode(@Param('id') assetId: string, @UserOrganization() userOrganization: any) {
    return this.assetsService.canSwitchTrackingMode(assetId, userOrganization.id);
  }

  @Post('adjust-quantity')
  @Permissions('assets:update')
  @ApiOperation({ summary: 'Adjust quantity for an untracked product' })
  @ApiBody({ type: AdjustQuantityDto })
  @ApiResponse({ status: 200, description: 'The quantity has been successfully adjusted.' })
  @ApiResponse({ status: 400, description: 'Invalid input or asset is tracked.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async adjustQuantity(
    @Body() adjustQuantityDto: AdjustQuantityDto,
    @UserOrganization() userOrganization: any,
    @Req() req: any,
  ) {
    const user = req.user;
    const adjustedBy = user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.emailAddresses?.[0]?.emailAddress || user?.id || 'Unknown';
    return this.assetsService.adjustQuantity(adjustQuantityDto, userOrganization.id, adjustedBy);
  }

  @Get(':id/quantity-history')
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get quantity adjustment history for an asset' })
  @ApiParam({ name: 'id', type: 'string', description: 'The ID of the asset' })
  @ApiQuery({ name: 'page', type: 'number', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', type: 'number', required: false, description: 'Items per page (default: 20)' })
  @ApiResponse({ status: 200, description: 'List of quantity adjustment history records.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  async getQuantityHistory(
    @Param('id') assetId: string,
    @UserOrganization() userOrganization: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.assetsService.getQuantityHistory(
      assetId,
      userOrganization.id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }
}
