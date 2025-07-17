import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { Request } from 'express';

// Extend the Express Request interface to include our custom properties
interface CustomRequest extends Request {
  user?: any;
  userOrganization?: any;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<CustomRequest>();
    const user = request.user;
    const startTime = Date.now();

    // Expanded skip list to reduce noise and improve performance
    const skipEndpoints = [
      '/health',
      '/metrics',
      '/audit/logs',
      '/_next',
      '/favicon.ico',
      '/api/trpc',
      '/static',
      '/images',
      '/assets',
      '/admin/dashboard/stats', // Skip dashboard stats as they're called frequently
      '/admin/dashboard', // Skip dashboard endpoints
      '/admin/audit/summary', // Skip audit summary
      '/uploads', // Skip file upload endpoints
      '/assets/upload', // Skip asset uploads
      '/documents/upload', // Skip document uploads
    ];

    if (skipEndpoints.some((endpoint) => request.url.includes(endpoint))) {
      return next.handle();
    }

    // Skip GET requests for better performance (optional - remove if you want to log reads)
    if (request.method === 'GET' && !request.url.includes('/admin/')) {
      return next.handle();
    }

    // Extract action and resource from the request
    const { method, url, body, params, query } = request;
    const action = this.getActionFromMethod(method);
    const resource = this.getResourceFromUrl(url);
    const resourceId = params?.id || body?.id || query?.id;
    const resourceName = this.getResourceName(resource, body, params, query);

    return next.handle().pipe(
      tap((response) => {
        const duration = Date.now() - startTime;

        // Only log if duration is significant or it's an important action
        if (duration > 1000 || this.isImportantAction(action, resource)) {
          this.auditService.logUserAction(user?.id || 'anonymous', action, resource, {
            resourceId,
            resourceName,
            organizationId: request.userOrganization?.id,
            userName: user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.firstName || user?.lastName,
            userEmail: user?.emailAddresses?.[0]?.emailAddress,
            details: {
              method,
              url: url.split('?')[0], // Remove query params to reduce size
              duration,
              statusCode: 200,
              // Remove requestBody and responseSize to reduce storage
            },
            req: request,
          });
        }
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;

        // Always log errors
        this.auditService.logUserAction(user?.id || 'anonymous', action, resource, {
          resourceId,
          resourceName,
          organizationId: request.userOrganization?.id,
          userName: user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.firstName || user?.lastName,
          userEmail: user?.emailAddresses?.[0]?.emailAddress,
          status: 'FAILURE',
          errorMessage: error.message || 'Unknown error',
          details: {
            method,
            url: url.split('?')[0], // Remove query params to reduce size
            duration,
            statusCode: error.status || 500,
            // Remove requestBody and error details to reduce storage
          },
          req: request,
        });

        throw error;
      }),
    );
  }

  private isImportantAction(action: string, resource: string): boolean {
    // Define what actions are considered important enough to always log
    const importantActions = ['CREATE', 'UPDATE', 'DELETE'];
    const importantResources = ['USER', 'ROLE', 'PERMISSION', 'ORGANIZATION'];

    return importantActions.includes(action) || importantResources.includes(resource);
  }

  private getActionFromMethod(method: string): string {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'READ';
      case 'POST':
        return 'CREATE';
      case 'PUT':
      case 'PATCH':
        return 'UPDATE';
      case 'DELETE':
        return 'DELETE';
      default:
        return 'UNKNOWN';
    }
  }

  private getResourceFromUrl(url: string): string {
    const path = url.split('?')[0];
    const segments = path.split('/').filter(Boolean);

    // Map common URL patterns to resources
    if (segments.includes('users')) return 'USER';
    if (segments.includes('assets')) return 'ASSET';
    if (segments.includes('inventory')) return 'INVENTORY';
    if (segments.includes('documents')) return 'DOCUMENT';
    if (segments.includes('customers')) return 'CUSTOMER';
    if (segments.includes('projects')) return 'PROJECT';
    if (segments.includes('roles')) return 'ROLE';
    if (segments.includes('permissions')) return 'PERMISSION';
    if (segments.includes('organizations')) return 'ORGANIZATION';
    if (segments.includes('admin')) return 'ADMIN';

    return segments[0]?.toUpperCase() || 'UNKNOWN';
  }

  private getResourceName(resource: string, body: any, params: any, query: any): string {
    // Try to get a meaningful name for the resource
    if (body?.name) return body.name;
    if (body?.firstName && body?.lastName) return `${body.firstName} ${body.lastName}`;
    if (body?.email) return body.email;
    if (params?.id) return `${resource} ${params.id}`;
    if (query?.id) return `${resource} ${query.id}`;

    return resource;
  }

  private sanitizeRequestBody(body: any): any {
    if (!body) return null;

    // Create a copy and remove sensitive fields
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];

    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }
}
