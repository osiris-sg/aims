import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PaymentVouchersService, SaveVoucherDto } from './payment-vouchers.service';

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
  @ApiOperation({ summary: 'Create a blank Payment Voucher (next PV- number)' })
  create(@Req() req: RequestWithOrganization) {
    return this.service.create(requireOrgId(req), actorFrom(req));
  }

  @Get()
  @Permissions('payments:read')
  @ApiOperation({ summary: 'List Payment Vouchers' })
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(requireOrgId(req));
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

  @Get(':id')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Get one Payment Voucher' })
  getById(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.getById(requireOrgId(req), id);
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
