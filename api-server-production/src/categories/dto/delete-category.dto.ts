import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteCategoryDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
