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

  // Manufacturer serial — editable so a 'pending' placeholder can be given its
  // real identity from the dashboard (triggers the pending→instock auto-flip).
  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  cameraP2P?: string;

  // SIM card ID — filled by the office on the TSS child unit's detail page.
  // Flows into the update via the service's spread of the DTO.
  @IsString()
  @IsOptional()
  simCardId?: string;
}
