import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AccountingSettingsService } from './accounting-settings.service';
import { UpdateAccountingSettingsDto } from './dto/accounting-settings.dto';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting/settings')
@UseGuards(ClerkAuthGuard)
export class AccountingSettingsController {
  constructor(private readonly service: AccountingSettingsService) {}

  @Get()
  @Permissions('accounting:read')
  @ApiOperation({ summary: 'Get accounting settings for the current organization (creates defaults if missing)' })
  get(@Req() req: RequestWithOrganization) {
    return this.service.getOrCreate(requireOrgId(req));
  }

  @Put()
  @Permissions('accounting:update')
  @ApiOperation({ summary: 'Update accounting settings' })
  update(@Req() req: RequestWithOrganization, @Body() dto: UpdateAccountingSettingsDto) {
    return this.service.update(requireOrgId(req), dto);
  }
}
