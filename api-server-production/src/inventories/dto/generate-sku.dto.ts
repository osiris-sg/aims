import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class GenerateSkuDto {
  @IsString()
  @IsNotEmpty()
  assetId: string;

  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
