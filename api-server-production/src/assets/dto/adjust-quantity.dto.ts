import { IsNotEmpty, IsUUID, IsInt, IsEnum, IsOptional, IsString, Min } from 'class-validator';

export enum AdjustmentType {
  ADD = 'ADD',
  SUBTRACT = 'SUBTRACT',
  SET = 'SET',
}

export class AdjustQuantityDto {
  @IsUUID()
  @IsNotEmpty()
  assetId: string;

  @IsInt()
  @Min(0)
  @IsNotEmpty()
  amount: number;

  @IsEnum(AdjustmentType)
  @IsNotEmpty()
  type: AdjustmentType;

  @IsString()
  @IsOptional()
  reason?: string;
}
