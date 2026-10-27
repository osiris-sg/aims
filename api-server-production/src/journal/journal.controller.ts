import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { JournalService } from './journal.service';
import { CreateJournalEntryDto } from './dto/journal-entry.dto';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}


/**
 * Query dates arrive as "YYYY-MM-DD" from the date pickers. `new Date(s)` made
 * that MIDNIGHT UTC, so an "as of today" cut-off excluded everything posted
 * today after 08:00 Singapore (guru 2026-10-27: WCT's GL showed nothing while
 * its journals existed). A date-only END / as-of value now means the END of
 * that day in Singapore; a date-only START value the start of it. Full
 * timestamps pass through unchanged.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const startOfDay = (s: string): Date => (DATE_ONLY.test(s) ? new Date(`${s}T00:00:00.000+08:00`) : new Date(s));
const endOfDay = (s: string): Date => (DATE_ONLY.test(s) ? new Date(`${s}T23:59:59.999+08:00`) : new Date(s));

@ApiTags('journal')
@ApiBearerAuth()
@Controller('journal')
@UseGuards(ClerkAuthGuard)
export class JournalController {
  constructor(private readonly service: JournalService) {}

  @Get('entries')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'List journal entries' })
  @ApiQuery({ name: 'status', required: false, description: 'DRAFT | POSTED | VOID' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'sourceDocumentId', required: false })
  @ApiQuery({ name: 'sourcePaymentId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.findAll(requireOrgId(req), {
      status: q.status,
      type: q.type,
      sourceDocumentId: q.sourceDocumentId,
      sourcePaymentId: q.sourcePaymentId,
      startDate: q.startDate ? startOfDay(q.startDate) : undefined,
      endDate: q.endDate ? endOfDay(q.endDate) : undefined,
      page: q.page ? parseInt(q.page) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
  }

  @Get('entries/:id')
  @Permissions('journal:read')
  get(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.findOne(requireOrgId(req), id);
  }

  @Post('entries')
  @Permissions('journal:create')
  create(@Req() req: RequestWithOrganization, @Body() dto: CreateJournalEntryDto) {
    return this.service.create(requireOrgId(req), dto, req.auth?.userId);
  }

  @Post('entries/:id/confirm')
  @Permissions('journal:post')
  confirmEntry(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.confirmEntry(requireOrgId(req), id);
  }

  @Post('entries/:id/post')
  @Permissions('journal:post')
  post(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.post(requireOrgId(req), id, req.auth?.userId);
  }

  @Post('entries/:id/void')
  @Permissions('journal:void')
  void(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.void(requireOrgId(req), id, req.auth?.userId);
  }

  @Get('reports/trial-balance')
  @Permissions('journal:read')
  @ApiQuery({ name: 'asOfDate', required: false })
  trialBalance(@Req() req: RequestWithOrganization, @Query('asOfDate') asOfDate?: string) {
    return this.service.trialBalance(requireOrgId(req), asOfDate ? endOfDay(asOfDate) : undefined);
  }

  // Per-account debit/credit/net movement for a date range — powers the
  // Xero-style General Ledger summary (all accounts in one scroll).
  @Get('reports/account-activity')
  @Permissions('journal:read')
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  accountActivity(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.accountActivityReport(requireOrgId(req), {
      startDate: q.startDate ? startOfDay(q.startDate) : undefined,
      endDate: q.endDate ? endOfDay(q.endDate) : undefined,
    });
  }

  // Foreign Bank Listing — foreign-currency bank balances (base + foreign).
  @Get('reports/foreign-banks')
  @Permissions('journal:read')
  @ApiQuery({ name: 'asOf', required: false })
  foreignBankListing(@Req() req: RequestWithOrganization, @Query('asOf') asOf?: string) {
    return this.service.foreignBankListing(requireOrgId(req), { asOf: asOf ? endOfDay(asOf) : undefined });
  }

  // Xero-style Journal Report — posted journals grouped with balanced lines.
  @Get('reports/journal')
  @Permissions('journal:read')
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'orderBy', required: false, description: 'journalNumber | entryDate | postedAt' })
  journalReport(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.journalReport(requireOrgId(req), {
      startDate: q.startDate ? startOfDay(q.startDate) : undefined,
      endDate: q.endDate ? endOfDay(q.endDate) : undefined,
      orderBy: q.orderBy,
      includeUnposted: q.includeUnposted === 'true' || q.includeUnposted === '1',
    });
  }

  // Xero-style Bank Summary — opening / received / spent / closing per bank account.
  @Get('reports/bank-summary')
  @Permissions('journal:read')
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  bankSummary(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.bankSummary(requireOrgId(req), {
      startDate: q.startDate ? startOfDay(q.startDate) : undefined,
      endDate: q.endDate ? endOfDay(q.endDate) : undefined,
    });
  }

  // Xero-style General Ledger Detail — every posted line in the period,
  // grouped per account with running balance + net movement.
  @Get('reports/gl-detail')
  @Permissions('journal:read')
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'accountIds', required: false, description: 'comma-separated ChartOfAccount ids' })
  glDetail(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.glDetailReport(requireOrgId(req), {
      startDate: q.startDate ? startOfDay(q.startDate) : undefined,
      endDate: q.endDate ? endOfDay(q.endDate) : undefined,
      accountIds: q.accountIds ? String(q.accountIds).split(',').filter(Boolean) : undefined,
      includeOpening: q.includeOpening === '1' || q.includeOpening === 'true',
    });
  }

  @Get('reports/general-ledger/:accountId')
  @Permissions('journal:read')
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  generalLedger(
    @Req() req: RequestWithOrganization,
    @Param('accountId') accountId: string,
    @Query() q: any,
  ) {
    return this.service.generalLedger(requireOrgId(req), accountId, {
      startDate: q.startDate ? startOfDay(q.startDate) : undefined,
      endDate: q.endDate ? endOfDay(q.endDate) : undefined,
    });
  }

  @Get('reports/hub')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Finance Hub snapshot — KPIs + Action Queue + Insights' })
  hub(@Req() req: RequestWithOrganization) {
    return this.service.hubSnapshot(requireOrgId(req));
  }

  @Get('reports/profit-loss')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Profit & Loss with this-month / prev-month / YTD columns' })
  @ApiQuery({ name: 'cutOffDate', required: true })
  @ApiQuery({ name: 'closingStock', required: false, type: Number })
  profitLoss(@Req() req: RequestWithOrganization, @Query() q: any) {
    const cutOffDate = q.cutOffDate ? endOfDay(q.cutOffDate) : new Date();
    const closingStock = q.closingStock !== undefined ? Number(q.closingStock) : undefined;
    return this.service.profitLossReport(requireOrgId(req), { cutOffDate, closingStock });
  }

  @Get('reports/balance-sheet')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Balance Sheet as-of date' })
  @ApiQuery({ name: 'asOfDate', required: true })
  @ApiQuery({ name: 'closingStock', required: false, type: Number })
  balanceSheet(@Req() req: RequestWithOrganization, @Query() q: any) {
    const asOfDate = q.asOfDate ? endOfDay(q.asOfDate) : new Date();
    const closingStock = q.closingStock !== undefined ? Number(q.closingStock) : undefined;
    return this.service.balanceSheetReport(requireOrgId(req), { asOfDate, closingStock });
  }

  @Get('reports/cash-flow')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'Cash flow statement (indirect method) — operating / investing / financing' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  cashFlow(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.cashFlowReport(requireOrgId(req), {
      startDate: startOfDay(q.startDate),
      endDate: endOfDay(q.endDate),
    });
  }

  @Get('reports/gst')
  @Permissions('journal:read')
  @ApiOperation({ summary: 'GST F5-style report — output/input tax + per-document detail rows' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'OUTPUT_STANDARD | OUTPUT_ZERO | OUTPUT_EXEMPT | INPUT_STANDARD | INPUT_ZERO | INPUT_EXEMPT',
  })
  gstReport(@Req() req: RequestWithOrganization, @Query() q: any) {
    return this.service.gstReport(requireOrgId(req), {
      startDate: q.startDate ? startOfDay(q.startDate) : undefined,
      endDate: q.endDate ? endOfDay(q.endDate) : undefined,
      category: q.category,
    });
  }
}
