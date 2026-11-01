import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class DateRangeDto {
  @IsDateString()
  @IsOptional()
  startDate: string | null;

  @IsDateString()
  @IsOptional()
  endDate: string | null;
}

class FiltersDto {
  @ValidateNested()
  @Type(() => DateRangeDto)
  @IsOptional()
  createdOn: DateRangeDto;

  // Salesman = Customer.salesmanId (UserOrganization id). Applied server-side so
  // the filter spans all pages.
  @IsString()
  @IsOptional()
  salesmanId?: string;
}

export class GetCustomerDto {
  @IsNumber()
  @IsNotEmpty()
  page: number;

  @IsNumber()
  @IsNotEmpty()
  limit: number;

  @IsString()
  @IsOptional()
  search?: string;

  // Pickers (search as you type, no paging): exact code / UEN / old-code
  // matches first. "449" also matches phones and addresses, and the newest 20
  // of those could push the customer with old code 449 off the list.
  @IsBoolean()
  @IsOptional()
  exactFirst?: boolean;

  @ValidateNested()
  @Type(() => FiltersDto)
  @IsOptional()
  filters?: FiltersDto;
}
