import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
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

  @Get(':id')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Get one Journal Voucher' })
  getById(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.getById(requireOrgId(req), id);
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
