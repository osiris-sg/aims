import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCustomerDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  email: string | null;

  @IsOptional()
  @IsString()
  phone: string | null;

  @IsOptional()
  @IsString()
  address: string | null;

  @IsString()
  @IsOptional()
  createdAt?: Date | null;
}
