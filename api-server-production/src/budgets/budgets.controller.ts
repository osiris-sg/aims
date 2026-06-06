import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BudgetsService } from './budgets.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('budgets')
@ApiBearerAuth()
@Controller('budgets')
@UseGuards(ClerkAuthGuard)
export class BudgetsController {
  constructor(private readonly service: BudgetsService) {}

  @Get(':year')
  @Permissions('accounting:read')
  @ApiOperation({ summary: 'Get budget grid for one year (accounts × 12 months)' })
  getYear(@Req() req: RequestWithOrganization, @Param('year') year: string) {
    return this.service.getYear(requireOrgId(req), parseInt(year, 10));
  }

  @Put()
  @Permissions('accounting:update')
  @ApiOperation({ summary: 'Bulk-upsert budget rows. amount=0 deletes the row.' })
  bulkUpsert(
    @Req() req: RequestWithOrganization,
    @Body() body: { items: Array<{ accountId: string; year: number; month: number; amount: number }> },
  ) {
    return this.service.bulkUpsert(requireOrgId(req), body.items || []);
  }

  @Post('copy')
  @Permissions('accounting:create')
  @ApiOperation({ summary: 'Copy budgets from one year to another' })
  copyYear(@Req() req: RequestWithOrganization, @Body() body: { fromYear: number; toYear: number; overwrite?: boolean }) {
    return this.service.copyYear(requireOrgId(req), body.fromYear, body.toYear, !!body.overwrite);
  }

  @Get('report/:year')
  @Permissions('accounting:read')
  @ApiOperation({ summary: 'Budget vs Actual report for the year — month-by-month variances' })
  report(@Req() req: RequestWithOrganization, @Param('year') year: string) {
    return this.service.report(requireOrgId(req), parseInt(year, 10));
  }
}
