import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ContraService, CreateContraDto } from './contra.service';

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

// Contra set-off between a customer and the supplier that is the same company.
// Uses the payments:* permissions — a contra settles invoices and bills, which
// is payment collection on both sides — so no new permission strings need
// granting org by org.
@ApiTags('contra')
@ApiBearerAuth()
@Controller('contra')
@UseGuards(ClerkAuthGuard)
export class ContraController {
  constructor(private readonly service: ContraService) {}

  @Get('pairs')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Customer↔supplier pairs: confirmed, plus likely ones matched by name' })
  pairs(@Req() req: RequestWithOrganization) {
    return this.service.pairs(requireOrgId(req));
  }

  @Post('pairs/:customerId')
  @Permissions('payments:update')
  @ApiOperation({ summary: 'Pair a customer with the supplier that is the same company' })
  link(
    @Req() req: RequestWithOrganization,
    @Param('customerId') customerId: string,
    @Body() body: { supplierId: string },
  ) {
    return this.service.link(requireOrgId(req), customerId, body?.supplierId);
  }

  @Delete('pairs/:customerId')
  @Permissions('payments:update')
  @ApiOperation({ summary: 'Unpair a customer from its contra supplier' })
  unlink(@Req() req: RequestWithOrganization, @Param('customerId') customerId: string) {
    return this.service.link(requireOrgId(req), customerId, null);
  }

  @Get('items/:customerId')
  @Permissions('payments:read')
  @ApiOperation({ summary: "Their open invoices and our open bills, for the contra grid" })
  items(@Req() req: RequestWithOrganization, @Param('customerId') customerId: string) {
    return this.service.items(requireOrgId(req), customerId);
  }

  @Get('offsets')
  @Permissions('payments:read')
  @ApiOperation({ summary: 'Contra set-offs already recorded' })
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(requireOrgId(req));
  }

  @Post('offsets')
  @Permissions('payments:create')
  @ApiOperation({ summary: 'Record a contra — settles both sides, posts Dr creditors / Cr debtors' })
  create(@Req() req: RequestWithOrganization, @Body() dto: CreateContraDto) {
    return this.service.create(requireOrgId(req), dto, actorFrom(req));
  }
}
