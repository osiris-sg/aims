import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { CustomFieldsInterceptor } from '../interceptors/custom-fields.interceptor';

/**
 * Decorator to automatically handle custom fields for an entity
 * Apply to controller methods or entire controllers
 * @example
 * @WithCustomFields()
 * @Controller('assets')
 * export class AssetsController {}
 */
export function WithCustomFields() {
  return applyDecorators(
    UseInterceptors(CustomFieldsInterceptor)
  );
}