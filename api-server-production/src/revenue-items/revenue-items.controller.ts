import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RevenueItemsService } from './revenue-items.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('revenue-items')
@ApiBearerAuth()
@Controller('revenue-items')
@UseGuards(ClerkAuthGuard)
export class RevenueItemsController {
  constructor(private readonly service: RevenueItemsService) {}

  // Read is used by the invoice editor (sales) → documents:read.
  @Get()
  @Permissions('documents:read')
  list(@Req() req: RequestWithOrganization, @Query('type') type?: string, @Query('activeOnly') activeOnly?: string) {
    return this.service.list(orgId(req), { type, activeOnly: activeOnly === 'true' });
  }

  // Mutations are Accounting Setup (accountant/admin) → accounting:update.
  @Post()
  @Permissions('accounting:update')
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(orgId(req), body);
  }

  @Patch(':id')
  @Permissions('accounting:update')
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return this.service.update(orgId(req), id, body);
  }

  @Delete(':id')
  @Permissions('accounting:update')
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(orgId(req), id);
  }

  @Post('bulk')
  @Permissions('accounting:update')
  bulk(@Req() req: RequestWithOrganization, @Body() body: { items: any[] }) {
    return this.service.bulkUpsert(orgId(req), body?.items || []);
  }
}
