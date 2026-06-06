import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BankRecService } from './bank-rec.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('bank-rec')
@ApiBearerAuth()
@Controller('bank-rec')
@UseGuards(ClerkAuthGuard)
export class BankRecController {
  constructor(private readonly service: BankRecService) {}

  @Get('accounts')
  @Permissions('bankrec:read')
  @ApiOperation({ summary: 'List bank accounts available for reconciliation' })
  accounts(@Req() req: RequestWithOrganization) {
    return this.service.listBankAccounts(requireOrgId(req));
  }

  @Get('imports')
  @Permissions('bankrec:read')
  imports(@Req() req: RequestWithOrganization, @Query('bankAccountId') bankAccountId?: string) {
    return this.service.listImports(requireOrgId(req), bankAccountId);
  }

  @Get('imports/:id')
  @Permissions('bankrec:read')
  getImport(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.getImport(requireOrgId(req), id);
  }

  @Get('imports/:id/reconciliation')
  @Permissions('bankrec:read')
  reconciliation(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.reconciliation(requireOrgId(req), id);
  }

  @Post('imports/csv')
  @Permissions('bankrec:create')
  @ApiOperation({ summary: 'Import a CSV bank statement with explicit column mapping' })
  importCsv(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.importCsv(requireOrgId(req), req.auth?.userId, body);
  }

  @Post('imports/pdf')
  @Permissions('bankrec:create')
  @ApiOperation({ summary: 'Import a PDF/image bank statement via Claude vision extraction' })
  importPdf(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.importPdf(requireOrgId(req), req.auth?.userId, body);
  }

  @Post('imports/:id/auto-match')
  @Permissions('bankrec:create')
  autoMatch(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.autoMatch(requireOrgId(req), id);
  }

  @Delete('imports/:id')
  @Permissions('bankrec:create')
  deleteImport(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.deleteImport(requireOrgId(req), id);
  }

  @Post('lines/:lineId/match')
  @Permissions('bankrec:create')
  match(
    @Req() req: RequestWithOrganization,
    @Param('lineId') lineId: string,
    @Body() body: { journalLineId: string },
  ) {
    return this.service.manualMatch(requireOrgId(req), lineId, body.journalLineId, req.auth?.userId);
  }

  @Post('lines/:lineId/unmatch')
  @Permissions('bankrec:create')
  unmatch(@Req() req: RequestWithOrganization, @Param('lineId') lineId: string) {
    return this.service.unmatch(requireOrgId(req), lineId);
  }

  @Post('lines/:lineId/ignore')
  @Permissions('bankrec:create')
  ignore(@Req() req: RequestWithOrganization, @Param('lineId') lineId: string) {
    return this.service.ignore(requireOrgId(req), lineId);
  }

  @Post('lines/:lineId/suggest')
  @Permissions('bankrec:create')
  @ApiOperation({ summary: 'LLM-suggest the best GL account to categorize an unmatched bank line' })
  suggest(@Req() req: RequestWithOrganization, @Param('lineId') lineId: string) {
    return this.service.suggestAccount(requireOrgId(req), lineId);
  }

  @Post('lines/:lineId/post')
  @Permissions('bankrec:create')
  @ApiOperation({ summary: 'Create a new JE from an unmatched bank line (Dr/Cr Bank + contra)' })
  postAsNew(
    @Req() req: RequestWithOrganization,
    @Param('lineId') lineId: string,
    @Body() body: { contraAccountId: string; description?: string },
  ) {
    return this.service.postAsNewEntry(requireOrgId(req), lineId, body, req.auth?.userId);
  }
}
