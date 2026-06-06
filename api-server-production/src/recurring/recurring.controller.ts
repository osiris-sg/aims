import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RecurringService, Frequency } from './recurring.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('recurring')
@ApiBearerAuth()
@Controller('recurring-journals')
@UseGuards(ClerkAuthGuard)
export class RecurringController {
  constructor(private readonly service: RecurringService) {}

  @Get()
  @Permissions('journal:read')
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(requireOrgId(req));
  }

  @Get(':id')
  @Permissions('journal:read')
  findOne(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.findOne(requireOrgId(req), id);
  }

  @Post()
  @Permissions('journal:create')
  create(
    @Req() req: RequestWithOrganization,
    @Body()
    body: {
      name: string;
      description?: string;
      reference?: string;
      frequency: Frequency;
      nextRunDate: string;
      lines: Array<{ accountId: string; description?: string; debit: number; credit: number }>;
      endDate?: string;
    },
  ) {
    return this.service.create(requireOrgId(req), req.auth?.userId, body);
  }

  @Patch(':id')
  @Permissions('journal:create')
  update(
    @Req() req: RequestWithOrganization,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.update(requireOrgId(req), id, body);
  }

  @Delete(':id')
  @Permissions('journal:create')
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(requireOrgId(req), id);
  }

  @Post(':id/run')
  @Permissions('journal:create')
  @ApiOperation({ summary: 'Run a single template right now, regardless of next-run-date' })
  runOne(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.runOne(requireOrgId(req), id, req.auth?.userId);
  }

  @Post('run-due')
  @Permissions('journal:create')
  @ApiOperation({ summary: 'Run all templates that are due — called by the hub on load' })
  runDue(@Req() req: RequestWithOrganization) {
    return this.service.runDue(requireOrgId(req), req.auth?.userId);
  }
}
