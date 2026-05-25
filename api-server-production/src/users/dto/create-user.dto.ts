import { IsArray, IsEmail, IsNotEmpty, IsString, IsUUID, MinLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    description: 'The first name of the new user',
    example: 'John',
  })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({
    description: 'The last name of the new user',
    example: 'Doe',
    required: false,
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({
    description: 'The email address for the new user. Either email or username must be provided.',
    example: 'john.doe@example.com',
    required: false,
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: 'The username for the new user. Either email or username must be provided.',
    example: 'john.doe',
    required: false,
  })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiProperty({
    description: 'The password for the new user',
    example: 'SecurePassword123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({
    description: 'Array of role IDs to assign to the user',
    example: ['ebd3b621-17ba-479b-b65d-c9b670da91d4', 'another-role-id'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds: string[];

  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiProperty({
    description: 'The salesman code for the user (e.g., S001)',
    example: 'S001',
    required: false,
  })
  @IsString()
  @IsOptional()
  salesmanCode?: string;
}
