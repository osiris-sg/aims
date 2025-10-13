import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ConfigurationService } from '../../configuration/configuration.service';
import { REQUEST } from '@nestjs/core';

@Injectable()
export class CustomFieldsInterceptor implements NestInterceptor {
  constructor(
    private configurationService: ConfigurationService,
    @Inject(REQUEST) private request: any,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const entityType = this.getEntityTypeFromPath(request.path);
    const organizationId = request.organizationId;

    // Handle request (for CREATE/UPDATE operations)
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      if (request.body && request.body.customFields && entityType && organizationId) {
        // Extract custom fields from the body
        const customFields = request.body.customFields;
        delete request.body.customFields;

        // Store custom fields to be processed after the main entity is created/updated
        request.customFieldsToProcess = {
          values: customFields,
          entityType,
          organizationId,
        };
      }
    }

    return next.handle().pipe(
      mergeMap(async (data) => {
        // Handle custom fields processing after entity creation/update
        if (request.customFieldsToProcess && data && data.id) {
          await this.configurationService.setCustomFieldValues(
            data.id,
            request.customFieldsToProcess.entityType,
            {
              ...request.customFieldsToProcess.values,
              organizationId: request.customFieldsToProcess.organizationId,
            }
          );
        }

        // Enrich response with custom fields
        if (entityType && organizationId) {
          // Handle single entity response
          if (data && data.id && !Array.isArray(data)) {
            return await this.enrichWithCustomFields(data, entityType);
          }

          // Handle array of entities
          if (Array.isArray(data)) {
            return await Promise.all(
              data.map((item) => this.enrichWithCustomFields(item, entityType))
            );
          }

          // Handle paginated response
          if (data && data.items && Array.isArray(data.items)) {
            const enrichedItems = await Promise.all(
              data.items.map((item) => this.enrichWithCustomFields(item, entityType))
            );
            return {
              ...data,
              items: enrichedItems,
            };
          }
        }

        return data;
      }),
    );
  }

  private async enrichWithCustomFields(entity: any, entityType: string) {
    if (!entity || !entity.id) {
      return entity;
    }

    try {
      const customFieldValues = await this.configurationService.getCustomFieldValues(
        entity.id,
        entityType
      );

      const customFields = customFieldValues.reduce((acc, fieldValue) => {
        acc[fieldValue.customField.fieldName] = fieldValue.value;
        return acc;
      }, {} as Record<string, any>);

      return {
        ...entity,
        customFields,
      };
    } catch (error) {
      console.error('Error enriching with custom fields:', error);
      return entity;
    }
  }

  private getEntityTypeFromPath(path: string): string | null {
    // Map API paths to entity types
    const pathMappings: Record<string, string> = {
      '/assets': 'Asset',
      '/customers': 'Customer',
      '/documents': 'Document',
      '/inventories': 'Inventory',
      '/projects': 'Project',
    };

    for (const [pathPattern, entityType] of Object.entries(pathMappings)) {
      if (path.includes(pathPattern)) {
        return entityType;
      }
    }

    return null;
  }
}