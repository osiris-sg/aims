import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AirwallexSyncService } from './airwallex-sync.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('airwallex')
@ApiBearerAuth()
@Controller('airwallex')
@UseGuards(ClerkAuthGuard)
export class AirwallexSyncController {
  constructor(private readonly service: AirwallexSyncService) {}

  @Get('status')
  @Permissions('airwallex:read')
  status(@Req() req: RequestWithOrganization) {
    return this.service.status(requireOrgId(req));
  }

  @Post('sync')
  @Permissions('airwallex:create')
  @ApiOperation({ summary: 'Pull succeeded Airwallex ticket orders into the GL now' })
  sync(@Req() req: RequestWithOrganization) {
    return this.service.syncNow(requireOrgId(req));
  }
}
