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

  // ── Work sections (declared before the generic :id routes) ───────────────
  // Read is used by the quotation editor → documents:read.
  @Get('sections')
  @Permissions('documents:read')
  listSections(@Req() req: RequestWithOrganization, @Query('activeOnly') activeOnly?: string) {
    return this.service.listSections(orgId(req), activeOnly === 'true');
  }

  @Post('sections')
  @Permissions('accounting:update')
  createSection(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.createSection(orgId(req), body);
  }

  @Patch('sections/:id')
  @Permissions('accounting:update')
  updateSection(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return this.service.updateSection(orgId(req), id, body);
  }

  @Delete('sections/:id')
  @Permissions('accounting:update')
  removeSection(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.removeSection(orgId(req), id);
  }

  // ── Items ────────────────────────────────────────────────────────────────
  // Read is used by the invoice editor (sales) → documents:read.
  // ?workOnly=true returns just the work-library items (those in a section).
  @Get()
  @Permissions('documents:read')
  list(
    @Req() req: RequestWithOrganization,
    @Query('type') type?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('workOnly') workOnly?: string,
  ) {
    return this.service.list(orgId(req), { type, activeOnly: activeOnly === 'true', workOnly: workOnly === 'true' });
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
