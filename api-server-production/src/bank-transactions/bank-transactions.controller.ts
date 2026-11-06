import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BankTransactionsService, SaveBankTransactionDto } from './bank-transactions.service';

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

// Spend Money / Receive Money — direct bank transactions with no invoice
// behind them. Same permission family as receipts and vouchers (payments:*),
// so no new permission strings need org-by-org grants.
@ApiTags('bank-transactions')
@ApiBearerAuth()
@Controller('bank-transactions')
@UseGuards(ClerkAuthGuard)
export class BankTransactionsController {
  constructor(private readonly service: BankTransactionsService) {}

  @Get()
  @Permissions('payments:read')
  @ApiOperation({ summary: 'List Spend Money / Receive Money transactions' })
  @ApiQuery({ name: 'kind', required: false, description: 'SPEND | RECEIVE (default both)' })
  list(@Req() req: RequestWithOrganization, @Query('kind') kind?: string) {
    const k = kind === 'SPEND' || kind === 'RECEIVE' ? kind : null;
    return this.service.list(requireOrgId(req), k);
  }

  @Get(':id')
  @Permissions('payments:read')
  getById(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.getById(requireOrgId(req), id);
  }

  @Post()
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Record a Spend Money / Receive Money transaction — numbers it and posts its journal' })
  create(@Req() req: RequestWithOrganization, @Body() dto: SaveBankTransactionDto) {
    return this.service.create(requireOrgId(req), dto, actorFrom(req));
  }

  @Put(':id')
  @Permissions('payments:update')
  @ApiOperation({ summary: 'Save a transaction — voids and reposts its journal' })
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() dto: SaveBankTransactionDto) {
    return this.service.update(requireOrgId(req), id, dto, actorFrom(req));
  }

  @Post(':id/void')
  @Permissions('payments:delete')
  @ApiOperation({ summary: 'Void a transaction in place (journal voided, document kept)' })
  void(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.void(requireOrgId(req), id, actorFrom(req));
  }
}
