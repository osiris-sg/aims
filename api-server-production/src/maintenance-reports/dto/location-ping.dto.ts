import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A single GPS ping captured by the field-tech app. Mirrors the shape the
 * @capgo/background-geolocation plugin emits on its `Location` callback,
 * minus the alt/altitudeAccuracy/simulated fields which aren't used downstream.
 */
export class LocationPingDto {
  @ApiProperty({ description: 'GPS latitude.' })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ description: 'GPS longitude.' })
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ description: 'Horizontal accuracy in metres.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @ApiPropertyOptional({ description: 'Ground speed in metres per second.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @ApiPropertyOptional({ description: 'Heading in degrees from true north (0..360).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiProperty({ description: 'Capture timestamp on the phone (ISO 8601).' })
  @IsISO8601()
  timestamp!: string;
}

export class CreateLocationPingsDto {
  @ApiProperty({
    description: 'Batch of pings to record (typically 1, batched on poor connectivity).',
    type: [LocationPingDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LocationPingDto)
  pings!: LocationPingDto[];
}
