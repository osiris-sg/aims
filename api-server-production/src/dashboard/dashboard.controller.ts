import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
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

  // ── Operations dashboard (Biofuel, guru 2026-09-26) ────────────────────
  // Read-only aggregates. All five are GETs, so the global ActionLog
  // interceptor records them as views rather than bogus CREATEs.

  @Get('ops/stock')
  @Permissions('inventory:read')
  @ApiOperation({ summary: 'Stock on hand by product and status' })
  async getOpsStock(@Req() req: RequestWithOrganization) {
    return await this.dashboardService.getOpsStock(this.orgOf(req));
  }

  @Get('ops/movements')
  @Permissions('inventory:read')
  @ApiOperation({ summary: 'Recent units in and out' })
  async getOpsMovements(@Req() req: RequestWithOrganization, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit || '20', 10) || 20, 1), 100);
    return await this.dashboardService.getOpsMovements(this.orgOf(req), n);
  }

  @Get('ops/revenue')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Revenue by product over a date range' })
  async getOpsRevenue(
    @Req() req: RequestWithOrganization,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('assetId') assetId?: string,
  ) {
    const { start, end } = this.range(from, to);
    return await this.dashboardService.getOpsRevenue(this.orgOf(req), start, end, assetId || undefined);
  }

  @Get('ops/maintenance')
  @Permissions('dashboard:read')
  @ApiOperation({ summary: 'Service frequency and most-serviced units' })
  async getOpsMaintenance(
    @Req() req: RequestWithOrganization,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { start, end } = this.range(from, to);
    return await this.dashboardService.getOpsMaintenance(this.orgOf(req), start, end);
  }

  @Get('ops/map')
  @Permissions('inventory:read')
  @ApiOperation({ summary: 'Where the fleet sits, and where the team has been' })
  async getOpsMap(@Req() req: RequestWithOrganization) {
    return await this.dashboardService.getOpsMap(this.orgOf(req));
  }

  private orgOf(req: RequestWithOrganization): string {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return organizationId;
  }

  /** Defaults to the last 12 months when the caller gives no range. */
  private range(from?: string, to?: string): { start: Date; end: Date } {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(new Date().setMonth(new Date().getMonth() - 12));
    // An end date typed as a day means "including that day".
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) end.setDate(end.getDate() + 1);
    return { start, end };
  }
}
