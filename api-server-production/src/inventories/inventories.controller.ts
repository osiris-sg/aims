import { Controller, Post, Body, Delete, Put, Get, Param } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { GetInventoryDto } from './dto/get-inventory.dto';
import { DeleteInventoryDto } from './dto/delete-inventory.dto';
import { GenerateSkuDto } from './dto/generate-sku.dto';

@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventoriesService: InventoriesService) {}

  @Post()
  async getInventories(@Body() getInventoryDto: GetInventoryDto) {
    return await this.inventoriesService.getInventories(getInventoryDto);
  }

  @Get(':id')
  async getInventoryById(@Param('id') id: string) {
    return await this.inventoriesService.getInventoryById(id);
  }

  @Post('by-status')
  async getInventoriesByStatus(@Body('organizationId') organizationId: string, @Body('status') status?: string) {
    return await this.inventoriesService.getInventoriesByStatus(organizationId);
  }

  @Get('sku/:sku')
  async getInventoryBySku(@Param('sku') sku: string) {
    return await this.inventoriesService.getInventoryBySku(sku);
  }

  @Get('/asset/:assetId')
  async getInventoriesByAsset(@Param('assetId') assetId: string) {
    return await this.inventoriesService.getInventoriesByAsset(assetId);
  }

  @Post('create')
  async createInventories(@Body() createInventoryDto: CreateInventoryDto) {
    return await this.inventoriesService.createInventories(createInventoryDto);
  }

  @Put('update')
  async updateInventories(@Body() updateInventoryDto: UpdateInventoryDto) {
    return await this.inventoriesService.updateInventories(updateInventoryDto);
  }

  @Delete('delete')
  async deleteInventories(@Body() deleteInventoryDto: DeleteInventoryDto) {
    return await this.inventoriesService.deleteInventories(deleteInventoryDto);
  }

  @Post('generate-sku')
  async generateSku(@Body() generateSkuDto: GenerateSkuDto) {
    return await this.inventoriesService.generateSkuRange(generateSkuDto.assetId, generateSkuDto.quantity, generateSkuDto.organizationId);
  }

  @Get('qrcode/:sku')
  async getQRCode(@Param('sku') sku: string) {
    return await this.inventoriesService.generateQRCode(sku);
  }

  @Post('by-ids')
  async getByIds(@Body() getInventoriesByIdsDto: any) {
    return this.inventoriesService.getInventoriesByIds(getInventoriesByIdsDto);
  }
}
