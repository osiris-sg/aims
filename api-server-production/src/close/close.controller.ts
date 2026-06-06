import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CloseService } from './close.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('close')
@ApiBearerAuth()
@Controller('close')
@UseGuards(ClerkAuthGuard)
export class CloseController {
  constructor(private readonly service: CloseService) {}

  @Get('preflight')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Pre-close checklist — returns pass/warn/fail per item' })
  @ApiQuery({ name: 'cutOffDate', required: true })
  preflight(@Req() req: RequestWithOrganization, @Query('cutOffDate') cutOffDate: string) {
    return this.service.preflight(requireOrgId(req), new Date(cutOffDate));
  }

  @Post('run')
  @Permissions('journal:post')
  @ApiOperation({ summary: 'Execute the close — lock period (MONTH_END) or rollover + lock (YEAR_END)' })
  run(
    @Req() req: RequestWithOrganization,
    @Body() body: { cutOffDate: string; type: 'MONTH_END' | 'YEAR_END'; skipWarnings?: boolean },
  ) {
    return this.service.run(requireOrgId(req), {
      cutOffDate: new Date(body.cutOffDate),
      type: body.type,
      skipWarnings: body.skipWarnings,
      userId: req.auth?.userId,
    });
  }

  @Post('unlock')
  @Permissions('journal:post')
  @ApiOperation({ summary: 'Admin escape hatch — clear the period lock (does not reverse a YE rollover)' })
  unlock(@Req() req: RequestWithOrganization) {
    return this.service.unlock(requireOrgId(req));
  }
}
