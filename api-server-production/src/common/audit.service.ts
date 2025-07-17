import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Request } from 'express';

export interface AuditLogData {
  userId: string;
  userName?: string;
  userEmail?: string;
  action: string;
  resource: string;
  resourceId?: string;
  resourceName?: string;
  organizationId?: string;
  details?: any;
  status?: 'SUCCESS' | 'FAILURE' | 'PENDING';
  errorMessage?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logAction(data: AuditLogData, req?: Request): Promise<void> {
    try {
      const ipAddress = req?.ip || req?.connection?.remoteAddress || 'unknown';
      const userAgent = req?.headers['user-agent'] || 'unknown';

      // Truncate large fields to prevent database bloat
      const truncatedDetails = this.truncateJsonField(data.details, 1000);
      const truncatedUserAgent = userAgent.length > 500 ? userAgent.substring(0, 500) + '...' : userAgent;

      // Use explicit type casting to avoid TypeScript issues
      await (this.prisma as any).auditLog.create({
        data: {
          userId: data.userId,
          userName: data.userName?.substring(0, 100), // Limit name length
          userEmail: data.userEmail?.substring(0, 100), // Limit email length
          action: data.action,
          resource: data.resource,
          resourceId: data.resourceId?.substring(0, 100), // Limit resource ID length
          resourceName: data.resourceName?.substring(0, 200), // Limit resource name length
          organizationId: data.organizationId,
          details: truncatedDetails,
          ipAddress: ipAddress.substring(0, 45), // Limit IP address length
          userAgent: truncatedUserAgent,
          status: data.status || 'SUCCESS',
          errorMessage: data.errorMessage?.substring(0, 500), // Limit error message length
        },
      });

      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.log('Audit log created', { action: data.action, resource: data.resource, userId: data.userId });
      }
    } catch (error) {
      // Don't let audit logging failures break the main application
      console.error('Failed to log audit action:', error);
    }
  }

  private truncateJsonField(obj: any, maxSize: number): any {
    if (!obj) return null;

    const jsonStr = JSON.stringify(obj);
    if (jsonStr.length <= maxSize) return obj;

    // If too large, keep only essential fields
    const essential = {
      method: obj.method,
      url: obj.url,
      duration: obj.duration,
      statusCode: obj.statusCode,
    };

    return essential;
  }

  async logUserAction(
    userId: string,
    action: string,
    resource: string,
    options: {
      resourceId?: string;
      resourceName?: string;
      organizationId?: string;
      details?: any;
      status?: 'SUCCESS' | 'FAILURE' | 'PENDING';
      errorMessage?: string;
      userName?: string;
      userEmail?: string;
      req?: Request;
    } = {},
  ): Promise<void> {
    await this.logAction(
      {
        userId,
        action,
        resource,
        ...options,
      },
      options.req,
    );
  }

  async getAuditLogs(
    filters: {
      userId?: string;
      action?: string;
      resource?: string;
      organizationId?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{
    logs: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { userId, action, resource, organizationId, startDate, endDate, page = 1, limit = 15 } = filters; // Optimized default limit

    const where: any = {};

    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (organizationId) where.organizationId = organizationId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    // Use Promise.all for parallel execution and minimal select for better performance
    const [logs, total] = await Promise.all([
      (this.prisma as any).auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          userId: true,
          userName: true,
          userEmail: true,
          action: true,
          resource: true,
          resourceId: true,
          resourceName: true,
          organizationId: true,
          ipAddress: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          // Exclude details field to reduce payload size
        },
      }),
      (this.prisma as any).auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      page,
      limit,
    };
  }

  // Convenience methods for common actions
  async logCreate(userId: string, resource: string, resourceId: string, resourceName: string, options: any = {}): Promise<void> {
    await this.logUserAction(userId, 'CREATE', resource, {
      resourceId,
      resourceName,
      ...options,
    });
  }

  async logUpdate(userId: string, resource: string, resourceId: string, resourceName: string, options: any = {}): Promise<void> {
    await this.logUserAction(userId, 'UPDATE', resource, {
      resourceId,
      resourceName,
      ...options,
    });
  }

  async logDelete(userId: string, resource: string, resourceId: string, resourceName: string, options: any = {}): Promise<void> {
    await this.logUserAction(userId, 'DELETE', resource, {
      resourceId,
      resourceName,
      ...options,
    });
  }

  async logLogin(userId: string, userName?: string, userEmail?: string, options: any = {}): Promise<void> {
    await this.logUserAction(userId, 'LOGIN', 'AUTH', {
      userName,
      userEmail,
      ...options,
    });
  }

  async logLogout(userId: string, userName?: string, userEmail?: string, options: any = {}): Promise<void> {
    await this.logUserAction(userId, 'LOGOUT', 'AUTH', {
      userName,
      userEmail,
      ...options,
    });
  }
}
 