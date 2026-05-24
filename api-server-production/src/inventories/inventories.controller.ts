import { Controller, Post, Body, Delete, Put, Get, Param, Req, UseGuards } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { GetInventoryDto } from './dto/get-inventory.dto';
import { DeleteInventoryDto } from './dto/delete-inventory.dto';
import { GenerateSkuDto } from './dto/generate-sku.dto';
import { CreateInventoryAndBindDto } from './dto/create-and-bind.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@Controller('inventories')
@UseGuards(ClerkAuthGuard)
export class InventoriesController {
  constructor(private readonly inventoriesService: InventoriesService) {}

  @Post()
  @Permissions('inventories:read')
  async getInventories(@Body() getInventoryDto: GetInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventories(getInventoryDto, organizationId);
  }

  // NOTE: Specific routes like :id/documents must come BEFORE generic :id route
  @Get(':id/stock-movements')
  @Permissions('inventories:read')
  async getStockMovements(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getStockMovementHistory(id, organizationId);
  }

  @Get(':id/documents')
  @Permissions('inventories:read')
  async getDocumentsForItem(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getDocumentsForItem(id, organizationId);
  }

  // Generic :id route must come AFTER specific :id/xxx routes
  @Get(':id')
  @Permissions('inventories:read-one')
  async getInventoryById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoryById(id, organizationId);
  }

  @Post('by-status')
  @Permissions('inventories:read-by-status')
  async getInventoriesByStatus(@Req() req: RequestWithOrganization, @Body('status') status?: string) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoriesByStatus(organizationId, status);
  }

  @Get('sku/:sku')
  @Permissions('inventories:read-by-sku')
  async getInventoryBySku(@Param('sku') sku: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoryBySku(sku, organizationId);
  }

  @Get('/asset/:assetId')
  @Permissions('inventories:read-by-asset')
  async getInventoriesByAsset(@Param('assetId') assetId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoriesByAsset(assetId, organizationId);
  }

  @Post('create')
  @Permissions('inventories:create')
  async createInventories(@Body() createInventoryDto: CreateInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.createInventories(createInventoryDto, organizationId);
  }

  @Post('create-and-bind')
  @Permissions('assets:bind-nfc-tag')
  async createAndBind(@Body() body: CreateInventoryAndBindDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.createAndBind(body, organizationId);
  }

  @Put('update')
  @Permissions('inventories:update')
  async updateInventories(@Body() updateInventoryDto: UpdateInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.updateInventories(updateInventoryDto, organizationId);
  }

  @Delete('delete')
  @Permissions('inventories:delete')
  async deleteInventories(@Body() deleteInventoryDto: DeleteInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.deleteInventories(deleteInventoryDto, organizationId);
  }

  @Post('generate-sku')
  @Permissions('inventories:generate-sku')
  async generateSku(@Body() generateSkuDto: GenerateSkuDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.generateSkuRange(generateSkuDto.assetId, generateSkuDto.quantity, organizationId);
  }

  @Get('qrcode/:sku')
  @Permissions('inventories:generate-qrcode')
  async getQRCode(@Param('sku') sku: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.generateQRCode(sku, organizationId);
  }

  @Post('by-ids')
  @Permissions('inventories:read-by-ids')
  async getByIds(@Body() getInventoriesByIdsDto: any, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.inventoriesService.getInventoriesByIds(getInventoriesByIdsDto, organizationId);
  }
}
