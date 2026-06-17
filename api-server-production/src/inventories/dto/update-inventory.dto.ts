import { PartialType } from '@nestjs/swagger';
import { CreateInventoryDto } from './create-inventory.dto';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsEnum } from 'class-validator';
import { InventoryStatus } from '@prisma/client';

export class UpdateInventoryDto extends PartialType(CreateInventoryDto) {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsOptional()
  assetId?: string;

  @IsNumber()
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  category?: string;

  @IsEnum(InventoryStatus)
  @IsOptional()
  status?: InventoryStatus;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  cameraP2P?: string;
}
