import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JournalVouchersService, SaveJournalVoucherDto } from './journal-vouchers.service';

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

// Journal Vouchers — the legacy J/V screen as a document (2026-11-09). Same
// permission family as manual journals (journal:*).
@ApiTags('journal-vouchers')
@ApiBearerAuth()
@Controller('journal-vouchers')
@UseGuards(ClerkAuthGuard)
export class JournalVouchersController {
  constructor(private readonly service: JournalVouchersService) {}

  @Post()
  @Permissions('journal:create')
  @ApiOperation({ summary: 'Create a blank Journal Voucher shell (numbered on first save)' })
  create(@Req() req: RequestWithOrganization) {
    return this.service.create(requireOrgId(req), actorFrom(req));
  }

  @Get()
  @Permissions('journal:read')
  @ApiOperation({ summary: 'List Journal Vouchers (newest first)' })
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(requireOrgId(req));
  }

  // The LIST PAGE (search box, Filter, pager, stat cards). Everything is done
  // in SQL: 'GET /journal-vouchers' still answers the plain newest-first array
  // the editor uses, but it cannot be the list page's source once an org holds
  // thousands of imported vouchers (guru 2026-11-18).
  @Get('paged')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'List page: Journal Vouchers filtered, paged and totalled server-side' })
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

  @Get(':id')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Get one Journal Voucher' })
  getById(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.getById(requireOrgId(req), id);
  }

  // Duplicate — copies THIS voucher as a new unconfirmed one dated today
  // (guru 2026-11-19). The generic /documents/:id/duplicate opened the copy on
  // the sales-document editor; a J/V copy belongs on the J/V screen.
  @Post(':id/duplicate')
  @Permissions('journal:create')
  @ApiOperation({ summary: 'Duplicate a Journal Voucher — same lines, new unconfirmed voucher dated today' })
  duplicate(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.duplicate(requireOrgId(req), id, actorFrom(req));
  }

  @Put(':id')
  @Permissions('journal:create')
  @ApiOperation({ summary: 'Save a Journal Voucher — posts / updates its manual journal (number = voucher number)' })
  save(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() dto: SaveJournalVoucherDto) {
    return this.service.save(requireOrgId(req), id, dto, actorFrom(req));
  }

  @Delete(':id')
  @Permissions('journal:void')
  @ApiOperation({ summary: 'Delete a Journal Voucher — voids its journal, removes any supplier offset rows' })
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(requireOrgId(req), id, actorFrom(req));
  }
}
