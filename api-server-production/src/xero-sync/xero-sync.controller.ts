import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { XeroSyncService } from './xero-sync.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('xero-sync')
@ApiBearerAuth()
@Controller('xero-sync')
@UseGuards(ClerkAuthGuard)
export class XeroSyncController {
  constructor(private readonly service: XeroSyncService) {}

  @Get('status')
  @Permissions('xerosync:read')
  status(@Req() req: RequestWithOrganization) {
    return this.service.status(requireOrgId(req));
  }

  @Get('runs')
  @Permissions('xerosync:read')
  runs(@Req() req: RequestWithOrganization) {
    return this.service.listRuns(requireOrgId(req));
  }

  @Post('run')
  @Permissions('xerosync:create')
  @ApiOperation({ summary: 'Pull selected scopes from Xero (defaults to accounts + contacts)' })
  run(
    @Req() req: RequestWithOrganization,
    @Body() body: { scope?: { accounts?: boolean; contacts?: boolean } },
  ) {
    return this.service.run(requireOrgId(req), body.scope ?? { accounts: true, contacts: true }, req.auth?.userId);
  }

  // -------- Account mappings --------

  @Get('account-mappings')
  @Permissions('xerosync:read')
  listMappings(@Req() req: RequestWithOrganization) {
    return this.service.listMappings(requireOrgId(req));
  }

  @Patch('account-mappings/:xeroAccountId')
  @Permissions('xerosync:create')
  @ApiOperation({ summary: 'Set / confirm the AIMS account mapping for a Xero account' })
  setMapping(
    @Req() req: RequestWithOrganization,
    @Param('xeroAccountId') xeroAccountId: string,
    @Body() body: { aimsAccountId: string | null },
  ) {
    return this.service.setMapping(requireOrgId(req), xeroAccountId, body.aimsAccountId);
  }

  @Post('account-mappings/:xeroAccountId/create-aims')
  @Permissions('xerosync:create')
  @ApiOperation({ summary: 'Create an AIMS account from this unmapped Xero account and link them' })
  createFromXero(@Req() req: RequestWithOrganization, @Param('xeroAccountId') xeroAccountId: string) {
    return this.service.createAimsFromXero(requireOrgId(req), xeroAccountId);
  }

  @Post('account-mappings/auto-map')
  @Permissions('xerosync:create')
  @ApiOperation({ summary: 'LLM-suggest mappings for all currently-unmapped Xero accounts' })
  autoMap(@Req() req: RequestWithOrganization) {
    return this.service.autoMapWithLlm(requireOrgId(req));
  }
}
