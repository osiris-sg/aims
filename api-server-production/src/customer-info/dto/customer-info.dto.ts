import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Office: mint a Customer Information collection link for a chosen customer +
 * project. Only existing customers/projects are pickable (no inline create),
 * and the ids are snapshotted onto the request row as plain values.
 */
export class CreateCustomerInfoRequestDto {
  @ApiProperty({ description: 'Existing customer (UUID).' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ description: 'Existing project (UUID) belonging to that customer.' })
  @IsUUID()
  projectId!: string;
}

/** One contact person supplied by the recipient on the public page. */
export class PublicContactDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  phone?: string;
}

/**
 * Public: the recipient submits the two contact groups. Both arrays are
 * optional (a group can legitimately be empty) but at least one contact overall
 * is required, enforced in the service.
 */
export class SubmitCustomerInfoDto {
  @ApiProperty({ type: [PublicContactDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicContactDto)
  doContacts?: PublicContactDto[];

  @ApiProperty({ type: [PublicContactDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicContactDto)
  invoiceContacts?: PublicContactDto[];
}
