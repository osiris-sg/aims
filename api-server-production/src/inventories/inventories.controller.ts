import { Controller, Post, Body, Delete, Put, Get, Param, Req, UseGuards } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { GetInventoryDto } from './dto/get-inventory.dto';
import { DeleteInventoryDto } from './dto/delete-inventory.dto';
import { GenerateSkuDto } from './dto/generate-sku.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';

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
  async getInventories(@Body() getInventoryDto: GetInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventories(getInventoryDto, organizationId);
  }

  @Get(':id')
  async getInventoryById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoryById(id, organizationId);
  }

  @Post('by-status')
  async getInventoriesByStatus(@Req() req: RequestWithOrganization, @Body('status') status?: string) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoriesByStatus(organizationId, status);
  }

  @Get('sku/:sku')
  async getInventoryBySku(@Param('sku') sku: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoryBySku(sku, organizationId);
  }

  @Get('/asset/:assetId')
  async getInventoriesByAsset(@Param('assetId') assetId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.getInventoriesByAsset(assetId, organizationId);
  }

  @Post('create')
  async createInventories(@Body() createInventoryDto: CreateInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.createInventories(createInventoryDto, organizationId);
  }

  @Put('update')
  async updateInventories(@Body() updateInventoryDto: UpdateInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.updateInventories(updateInventoryDto, organizationId);
  }

  @Delete('delete')
  async deleteInventories(@Body() deleteInventoryDto: DeleteInventoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.deleteInventories(deleteInventoryDto, organizationId);
  }

  @Post('generate-sku')
  async generateSku(@Body() generateSkuDto: GenerateSkuDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.generateSkuRange(generateSkuDto.assetId, generateSkuDto.quantity, organizationId);
  }

  @Get('qrcode/:sku')
  async getQRCode(@Param('sku') sku: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.inventoriesService.generateQRCode(sku, organizationId);
  }

  @Post('by-ids')
  async getByIds(@Body() getInventoriesByIdsDto: any, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.inventoriesService.getInventoriesByIds(getInventoriesByIdsDto, organizationId);
  }
}
