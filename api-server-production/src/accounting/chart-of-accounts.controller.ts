import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting/accounts')
@UseGuards(ClerkAuthGuard)
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @Permissions('accounting:read')
  @ApiOperation({ summary: 'List chart of accounts for the current organization' })
  @ApiQuery({ name: 'category', required: false, description: 'PNL | BALANCE_SHEET' })
  @ApiQuery({ name: 'accountType', required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findAll(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.findAll(requireOrgId(req), {
      category: q.category,
      accountType: q.accountType,
      includeInactive: q.includeInactive === 'true',
    });
  }

  @Get(':id')
  @Permissions('accounting:read')
  findOne(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.findOne(requireOrgId(req), id);
  }

  @Post()
  @Permissions('accounting:create')
  create(@Req() req: RequestWithOrganization, @Body() dto: CreateChartOfAccountDto) {
    return this.service.create(requireOrgId(req), dto);
  }

  @Post('seed-defaults')
  @Permissions('accounting:create')
  @ApiOperation({ summary: 'Seed the default Singapore SME chart of accounts (only if empty)' })
  seedDefaults(@Req() req: RequestWithOrganization) {
    return this.service.seedDefaults(requireOrgId(req));
  }

  @Patch(':id')
  @Permissions('accounting:update')
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() dto: UpdateChartOfAccountDto) {
    return this.service.update(requireOrgId(req), id, dto);
  }

  @Delete(':id')
  @Permissions('accounting:delete')
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(requireOrgId(req), id);
  }
}
