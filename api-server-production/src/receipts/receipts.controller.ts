import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreateOffsetDto, ReceiptsService, SaveReceiptDto } from './receipts.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
  user?: any;
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

// Same shape as documents.controller's actorFromReq (guard puts Clerk user on req.user).
function actorFrom(req: RequestWithOrganization) {
  const u: any = req.user || {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return { id: u.id || req.auth?.userId, name: name || undefined, email: u.emailAddresses?.[0]?.emailAddress };
}

// Official Receipts. Uses the payments:* permissions (a receipt IS customer
// payment collection) so no new permission strings need org-by-org grants.
@ApiTags('receipts')
@ApiBearerAuth()
@Controller('receipts')
@UseGuards(ClerkAuthGuard)
export class ReceiptsController {
  constructor(private readonly service: ReceiptsService) {}

  @Post()
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Create a blank Official Receipt (next OR- number)' })
  create(@Req() req: RequestWithOrganization) {
    return this.service.create(requireOrgId(req), actorFrom(req));
  }

  @Get()
  @Permissions('payments:read')
  @ApiOperation({ summary: 'List Official Receipts' })
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(requireOrgId(req));
  }

  @Get('open-invoices/:customerId')
  @Permissions('payments:read')
  @ApiOperation({ summary: "Customer's unpaid invoices for the allocation grid" })
  openInvoices(
    @Req() req: RequestWithOrganization,
    @Param('customerId') customerId: string,
    @Query('excludeReceiptId') excludeReceiptId?: string,
  ) {
    return this.service.openInvoices(requireOrgId(req), customerId, { excludeReceiptId });
  }

  // ----- Manual Offset (credit notes ↔ invoices, no cash) -----
  // Declared before ':id' so the literal paths aren't swallowed by the param route.

  @Get('offset-items/:customerId')
  @Permissions('payments:read')
  @ApiOperation({ summary: "Customer's open invoices (debits) and credit notes (credits) for Manual Offset" })
  offsetItems(@Req() req: RequestWithOrganization, @Param('customerId') customerId: string) {
    return this.service.offsetItems(requireOrgId(req), customerId);
  }

  @Post('offsets')
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Create a Manual Offset — settles ticked invoices against credit notes' })
  createOffset(@Req() req: RequestWithOrganization, @Body() dto: CreateOffsetDto) {
    return this.service.createOffset(requireOrgId(req), dto, actorFrom(req));
  }

  @Delete('offsets/:id')
  @Permissions('payments:delete')
  @ApiOperation({ summary: 'Delete a Manual Offset — voids its FX journal, restores both sides' })
  removeOffset(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.removeOffset(requireOrgId(req), id, actorFrom(req));
  }

  @Get(':id')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Get one Official Receipt' })
  getById(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.getById(requireOrgId(req), id);
  }

  @Put(':id')
  @Permissions('payments:update')
  @ApiOperation({ summary: 'Save a receipt — replaces allocations, reposts its single journal' })
  save(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() dto: SaveReceiptDto) {
    return this.service.save(requireOrgId(req), id, dto, actorFrom(req));
  }

  @Delete(':id')
  @Permissions('payments:delete')
  @ApiOperation({ summary: 'Delete a receipt — voids its journal, removes allocations' })
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(requireOrgId(req), id, actorFrom(req));
  }
}
