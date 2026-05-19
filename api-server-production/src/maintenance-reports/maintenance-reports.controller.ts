import { Body, Controller, Get, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { CreateMaintenanceReportDto } from './dto/create-maintenance-report.dto';
import { SignMaintenanceReportDto } from './dto/sign-maintenance-report.dto';
import { MaintenanceReportsService } from './maintenance-reports.service';

// Clerk strategy attaches the resolved User row at request.user (see
// src/auth/clerk.strategy.ts and the @Req() usage in users.controller.ts).
interface ClerkRequest extends Request {
  user?: { id?: string };
}

@ApiTags('maintenance-reports')
@Controller('maintenance-reports')
@UseGuards(ClerkAuthGuard)
export class MaintenanceReportsController {
  constructor(private readonly service: MaintenanceReportsService) {}

  @Post()
  @Permissions('maintenance-reports:create')
  create(
    @Body() dto: CreateMaintenanceReportDto,
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
  ) {
    const technicianUserId = req.user?.id;
    if (!technicianUserId) {
      throw new UnauthorizedException('Missing authenticated user');
    }
    return this.service.create(dto, org.id, technicianUserId);
  }

  @Post(':id/sign')
  @Permissions('maintenance-reports:sign')
  sign(
    @Param('id') id: string,
    @Body() dto: SignMaintenanceReportDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.sign(id, dto, org.id);
  }

  @Get(':id')
  @Permissions('maintenance-reports:read')
  findById(@Param('id') id: string, @UserOrganization() org: { id: string }) {
    return this.service.findById(id, org.id);
  }

  @Get('asset/:assetId')
  @Permissions('maintenance-reports:read')
  listByAsset(@Param('assetId') assetId: string, @UserOrganization() org: { id: string }) {
    return this.service.listByAsset(assetId, org.id);
  }

  /**
   * Single round-trip after an NFC scan: returns asset + latest DO + recent reports.
   */
  @Get('scan-context/:assetId')
  @Permissions('field-scan:access')
  getScanContext(
    @Param('assetId') assetId: string,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.getScanContext(assetId, org.id);
  }
}
