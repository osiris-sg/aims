import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class UpdateAssetParentDto {
  @ApiProperty({
    description: 'The ID of the asset to update',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsNotEmpty()
  assetId: string;

  @ApiProperty({
    description: 'The ID of the parent asset (null to make it a root asset)',
    example: '550e8400-e29b-41d4-a716-446655440001',
    required: false,
  })
  @IsString()
  @IsOptional()
  parentAssetId?: string | null;
}
