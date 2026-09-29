import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { MaintenanceSchedulesService } from './maintenance-schedules.service';

interface ClerkRequest extends Request {
  user?: { id?: string };
}

/**
 * Maintenance Dates (Biofuel, 2026-09): planned maintenance per asset, behind
 * the enableMaintenanceDates org flag. Reads use the same permission as the
 * office Deliveries list; writes the same as scheduling a delivery.
 */
@ApiTags('Maintenance Schedules')
@Controller('maintenance-schedules')
@UseGuards(ClerkAuthGuard)
export class MaintenanceSchedulesController {
  constructor(private readonly service: MaintenanceSchedulesService) {}

  @Get()
  @Permissions('maintenance-reports:read')
  list(@UserOrganization() org: { id: string }, @Query('search') search?: string) {
    return this.service.list(org.id, search);
  }

  @Get('assets/:assetId')
  @Permissions('maintenance-reports:read')
  assetDetail(@Param('assetId') assetId: string, @UserOrganization() org: { id: string }) {
    return this.service.assetDetail(org.id, assetId);
  }

  @Post()
  @Permissions('documents:create-basic')
  create(
    @Body() body: { assetId?: string; dueDate?: string; notes?: string; repeat?: { every?: number; unit?: string } | null },
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
  ) {
    return this.service.create(org.id, req.user?.id ?? null, body ?? {});
  }

  @Patch(':id')
  @Permissions('documents:create-basic')
  update(
    @Param('id') id: string,
    @Body() body: { dueDate?: string; notes?: string | null; repeat?: { every?: number; unit?: string } | null },
    @UserOrganization() org: { id: string },
  ) {
    return this.service.update(org.id, id, body ?? {});
  }

  // body.mode: "date" (default) cancels this occurrence and a repeating series
  // continues; "series" cancels it and stops repeating.
  @Post(':id/cancel')
  @Permissions('documents:create-basic')
  cancel(@Param('id') id: string, @Body() body: { mode?: 'date' | 'series' }, @UserOrganization() org: { id: string }) {
    return this.service.cancel(org.id, id, body?.mode ?? 'date');
  }
}
