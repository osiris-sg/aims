import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@ApiTags('dashboard')
@UseGuards(ClerkAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Get dashboard overview data' })
  @ApiResponse({ status: 200, description: 'Dashboard overview data' })
  async getDashboardOverview(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getDashboardOverview(organizationId);
  }

  @Get('assets-overview')
  @Permissions('assets:read')
  @ApiOperation({ summary: 'Get assets overview for dashboard' })
  @ApiResponse({ status: 200, description: 'Assets overview data' })
  async getAssetsOverview(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getAssetsOverview(organizationId);
  }

  @Get('invoices-due')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Get invoices due for dashboard' })
  @ApiResponse({ status: 200, description: 'Invoices due data' })
  async getInvoicesDue(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getInvoicesDue(organizationId);
  }

  @Get('delivery-orders-pending')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Get pending delivery orders for dashboard' })
  @ApiResponse({ status: 200, description: 'Pending delivery orders data' })
  async getDeliveryOrdersPending(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getDeliveryOrdersPending(organizationId);
  }

  @Get('projects-ending')
  @Permissions('projects:read')
  @ApiOperation({ summary: 'Get projects ending soon for dashboard' })
  @ApiResponse({ status: 200, description: 'Projects ending soon data' })
  async getProjectsEnding(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.dashboardService.getProjectsEnding(organizationId);
  }
}
