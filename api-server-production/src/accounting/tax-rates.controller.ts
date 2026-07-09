import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TaxRatesService } from './tax-rates.service';

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
@Controller('accounting/tax-rates')
@UseGuards(ClerkAuthGuard)
export class TaxRatesController {
  constructor(private readonly service: TaxRatesService) {}

  @Get()
  @Permissions('accounting:read')
  @ApiOperation({ summary: 'List GST tax codes (seeds the legacy 1-7 set on first read)' })
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(requireOrgId(req));
  }

  @Post()
  @Permissions('accounting:update')
  @ApiOperation({ summary: 'Add a custom tax code' })
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(requireOrgId(req), body);
  }

  @Patch(':id')
  @Permissions('accounting:update')
  @ApiOperation({ summary: 'Update a tax code (rate / name / active)' })
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return this.service.update(requireOrgId(req), id, body);
  }

  @Delete(':id')
  @Permissions('accounting:update')
  @ApiOperation({ summary: 'Delete a custom tax code (system codes deactivate instead)' })
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(requireOrgId(req), id);
  }
}
