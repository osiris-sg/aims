import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'FCM registration token from the device.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096) // FCM tokens are ~160 chars today; the cap is a sanity bound
  token!: string;

  @ApiProperty({ required: false, enum: ['android', 'ios', 'web'], default: 'android' })
  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  platform?: string;
}

export class DeleteDeviceTokenDto {
  @ApiProperty({ description: 'The token to drop (on logout / permission revoked).' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  token!: string;
}
