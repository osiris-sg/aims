import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreateApOffsetDto, PaymentVouchersService, SaveVoucherDto } from './payment-vouchers.service';

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

function actorFrom(req: RequestWithOrganization) {
  const u: any = req.user || {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return { id: u.id || req.auth?.userId, name: name || undefined, email: u.emailAddresses?.[0]?.emailAddress };
}

// Payment Vouchers — the AP twin of Official Receipts. Same permission family
// (payments:*) so no new permission strings need org-by-org grants.
@ApiTags('payment-vouchers')
@ApiBearerAuth()
@Controller('payment-vouchers')
@UseGuards(ClerkAuthGuard)
export class PaymentVouchersController {
  constructor(private readonly service: PaymentVouchersService) {}

  @Post()
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Create a blank Payment Voucher (next PV- number); with billId, one already set to pay that supplier invoice' })
  create(@Req() req: RequestWithOrganization, @Body() body?: { billId?: string }) {
    return this.service.create(requireOrgId(req), actorFrom(req), body?.billId ? { billId: String(body.billId) } : undefined);
  }

  @Get()
  @Permissions('payments:read')
  @ApiOperation({ summary: 'List Payment Vouchers' })
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(requireOrgId(req));
  }

  // The LIST PAGE (search box, Filter, pager, stat cards). Everything is done
  // in SQL: 'GET /payment-vouchers' still answers the plain newest-first array the
  // editor and the reports use, but it cannot be the list page's source once
  // an org holds thousands of imported vouchers (guru 2026-11-18).
  @Get('paged')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'List page: Payment Vouchers filtered, paged and totalled server-side' })
  listPaged(
    @Req() req: RequestWithOrganization,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listPaged(requireOrgId(req), { search, status, from, to, page: Number(page) || 1, limit: Number(limit) || 50 });
  }

  @Get('open-bills/:supplierId')
  @Permissions('payments:read')
  @ApiOperation({ summary: "Supplier's unpaid bills for the allocation grid" })
  openBills(
    @Req() req: RequestWithOrganization,
    @Param('supplierId') supplierId: string,
    @Query('excludeVoucherId') excludeVoucherId?: string,
  ) {
    return this.service.openBills(requireOrgId(req), supplierId, { excludeVoucherId });
  }

  // Declared before ':id' so the literal paths aren't swallowed by the param route.
  @Get('offset-items/:supplierId')
  @Permissions('payments:read')
  @ApiOperation({ summary: "Supplier's open invoices (debits) and credit notes (credits) for the AP Manual Offset" })
  offsetItems(@Req() req: RequestWithOrganization, @Param('supplierId') supplierId: string) {
    return this.service.offsetItems(requireOrgId(req), supplierId);
  }

  @Post('offsets')
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Create an AP Manual Offset — settles ticked supplier invoices against supplier credit notes, no cash' })
  createOffset(@Req() req: RequestWithOrganization, @Body() dto: CreateApOffsetDto) {
    return this.service.createOffset(requireOrgId(req), dto, actorFrom(req));
  }

  @Get(':id')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Get one Payment Voucher' })
  getById(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.getById(requireOrgId(req), id);
  }

  // Duplicate — a copy of THIS voucher as a new unconfirmed one dated today
  // (guru 2026-11-19); bank, payee and lines carry over, the bill offsets and
  // the cheque number do not.
  @Post(':id/duplicate')
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Duplicate a Payment Voucher — same bank, payee and lines, new unconfirmed voucher dated today' })
  duplicate(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.duplicate(requireOrgId(req), id, actorFrom(req));
  }

  @Put(':id')
  @Permissions('payments:update')
  @ApiOperation({ summary: 'Save a voucher — reposts its single journal, replaces the bill payments' })
  save(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() dto: SaveVoucherDto) {
    return this.service.save(requireOrgId(req), id, dto, actorFrom(req));
  }

  @Delete(':id')
  @Permissions('payments:delete')
  @ApiOperation({ summary: 'Delete a voucher — voids its journal, removes its bill payments' })
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(requireOrgId(req), id, actorFrom(req));
  }
}
