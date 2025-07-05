import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEnum } from 'class-validator';
import { InventoryStatus } from '@prisma/client';

export class CreateInventoryDto {
  @IsNotEmpty()
  assetId: string;

  @IsString()
  @IsOptional()
  location: string;

  @IsEnum(InventoryStatus)
  @IsNotEmpty()
  status: InventoryStatus;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsOptional()
  createdAt?: Date | null;
}
