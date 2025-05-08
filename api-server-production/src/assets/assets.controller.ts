import { Controller, Post, Body, Put, Delete, Param, Get } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { GetAssetDto } from './dto/get-assets.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { DeleteAssetDto } from './dto/delete-asset.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  getAssets(@Body() getAssetDto: GetAssetDto) {
    return this.assetsService.getAssets(getAssetDto);
  }

  @Get('skuKey/:skuKey')
  getAssetBySKUKEY(@Param('skuKey') skuKey: string) {
    return this.assetsService.getAssetBySKUKEY(skuKey);
  }

  @Get(':id')
  getAssetByID(@Param('id') id: string) {
    return this.assetsService.getAssetById(id);
  }

  @Post('create')
  createAssets(@Body() createAssetDto: CreateAssetDto) {
    return this.assetsService.createAssets(createAssetDto);
  }

  @Put('update')
  updateAssets(@Body() updateAssetDto: UpdateAssetDto) {
    return this.assetsService.updateAssets(updateAssetDto);
  }

  @Delete('delete')
  deleteAssets(@Body() deleteAssetDto: DeleteAssetDto) {
    return this.assetsService.deleteAssets(deleteAssetDto);
  }

  @Get('check-skuKey/:skuKey')
  checkSkuKey(@Param('skuKey') skuKey: string) {
    return this.assetsService.checkSkuKey(skuKey);
  }
}
