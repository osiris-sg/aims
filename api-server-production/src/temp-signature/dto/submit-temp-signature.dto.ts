import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * TEMPORARY standalone signature capture. The service re-validates everything
 * here (and decodes/sniffs the image) — these decorators are the first gate,
 * not the only one.
 */
export class SubmitTempSignatureDto {
  @ApiProperty({ description: 'Signer name, required.' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'PNG/JPEG signature as a base64 data URL, required.' })
  @IsString()
  @MinLength(1)
  signature!: string;

  @ApiProperty({ required: false, description: 'Optional free-text comment.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
