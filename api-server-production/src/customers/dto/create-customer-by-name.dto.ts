import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Name-only customer creation (field flows) — the narrow twin of
 * projects:create-by-name. Everything else (customerCode generation, contacts,
 * defaults) comes from the same customersService.createCustomers path the full
 * office form uses.
 */
export class CreateCustomerByNameDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}
