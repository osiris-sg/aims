import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

/** One keyed-in item on an ad-hoc return: the ID the rider typed plus optional photos. */
export class AdHocReturnLineDto {
  @ApiProperty({ description: 'The item ID as typed (serial / SKU). Matched case-insensitively, separators ignored.' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  id!: string;

  @ApiPropertyOptional({ description: 'Up to 8 S3 keys of condition photos for this item.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  photos?: string[];
}

/**
 * AD-HOC RETURN (field, 2026-10-22): a rider collects items on site with nothing
 * scheduled. Each ID either resolves to a unit out on rental (or sold) and
 * becomes a normal unit return line, or stays an "Untagged item: <ID>" line for
 * the office to link later.
 */
export class AdHocReturnDto {
  @ApiProperty({ type: [AdHocReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AdHocReturnLineDto)
  lines!: AdHocReturnLineDto[];

  @ApiPropertyOptional({ description: 'Free text: who the items were collected from. Printed on the RDO until a real customer is attached.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerText?: string;

  @ApiPropertyOptional({ description: 'Free text: the project / site. Stored as the run site and printed on the RDO until a real project is attached.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectText?: string;

  @ApiPropertyOptional({ description: 'Display name of the rider (snapshot).' })
  @IsOptional()
  @IsString()
  riderName?: string;

  @ApiPropertyOptional({ description: 'Technician name stamped on the proof rows.' })
  @IsOptional()
  @IsString()
  technicianName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  longitude?: number;
}
