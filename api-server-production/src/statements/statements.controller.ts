import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StatementsService } from './statements.service';
import { XeroReportsService, Side } from './xero-reports.service';
import { GenerateSOADto } from './dto/generate-soa.dto';
import { SendReportEmailDto } from './dto/send-report-email.dto';
import { EmailService } from '../email/email.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
  auth?: {
    userId: string;
  };
}

@ApiTags('statements')
@ApiBearerAuth()
@Controller('statements')
@UseGuards(ClerkAuthGuard)
export class StatementsController {
  constructor(
    private readonly statementsService: StatementsService,
    private readonly xeroReports: XeroReportsService,
    private readonly email: EmailService,
  ) {}

  // Email any report's PDF (Print / Export → Email…). Same permission as the
  // sales documents' send-email; the PDF comes from the portal's renderer.
  @Post('report/send-email')
  @Permissions('documents:send-email')
  @ApiOperation({ summary: 'Email a report PDF rendered by the portal (statement of accounts, trial balance, …)' })
  async sendReportEmail(@Req() req: RequestWithOrganization, @Body() dto: SendReportEmailDto) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const bad = [...dto.to, ...(dto.cc || []), ...(dto.bcc || [])].filter((e) => !valid(e));
    if (bad.length) throw new HttpException(`Invalid email: ${bad.join(', ')}`, HttpStatus.BAD_REQUEST);
    if (dto.pdfBase64.length > 12_000_000) throw new HttpException('Attachment too large', HttpStatus.BAD_REQUEST);
    const result = await this.email.sendReportEmail({
      to: dto.to,
      cc: dto.cc,
      bcc: dto.bcc,
      subject: dto.subject,
      message: dto.message,
      organizationName: req.userOrganization?.name || '',
      filename: dto.filename.endsWith('.pdf') ? dto.filename : `${dto.filename}.pdf`,
      pdfBase64: dto.pdfBase64,
    });
    if (!result.success) throw new HttpException(result.error || 'Failed to send email', HttpStatus.BAD_GATEWAY);
    return { success: true, messageId: result.messageId };
  }

  @Post('soa')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Generate Statement of Account for a customer' })
  @ApiResponse({ status: 200, description: 'Statement generated successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async generateSOA(
    @Body() generateSOADto: GenerateSOADto,
    @Req() req: RequestWithOrganization,
    @Res() res: Response,
  ) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    const result = await this.statementsService.generateSOA(generateSOADto, organizationId);

    // If CSV format, send as file download
    if (generateSOADto.format === 'csv' && 'content' in result) {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.send(result.content);
    }

    // Otherwise return JSON
    return res.json(result);
  }

  @Get('aging-summary')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Get aging summary for all customers' })
  @ApiResponse({ status: 200, description: 'Returns aging summary' })
  getAgingSummary(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;

    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    return this.statementsService.getAgingSummary(organizationId);
  }

  // --------- Supplier Statement of Account (AP-side mirror of /soa) ---------
  @Post('supplier-soa')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Generate Statement of Account for a supplier' })
  async generateSupplierSOA(
    @Body() body: { supplierId: string; startDate?: string; endDate?: string; includeAging?: boolean },
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.statementsService.generateSupplierSOA(body, organizationId);
  }

  // --------- Sales by Customer summary ---------
  @Get('sales-by-customer')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Aggregated sales totals per customer for a period' })
  salesByCustomer(
    @Req() req: RequestWithOrganization,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.statementsService.salesByCustomer(organizationId, startDate, endDate);
  }

  // --------- Purchases by Supplier summary ---------
  @Get('purchases-by-supplier')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Aggregated purchase totals per supplier for a period' })
  purchasesBySupplier(
    @Req() req: RequestWithOrganization,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.statementsService.purchasesBySupplier(organizationId, startDate, endDate);
  }

  // ================= Xero-parity AR/AP reports =================

  @Get('aged')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Aged receivables/payables, summary or detail, configurable buckets' })
  aged(
    @Req() req: RequestWithOrganization,
    @Query('side') side: Side = 'receivable',
    @Query('asOf') asOf?: string,
    @Query('periods') periods?: string,
    @Query('periodDays') periodDays?: string,
    @Query('ageingBy') ageingBy?: 'dueDate' | 'documentDate',
    @Query('level') level?: 'summary' | 'detail',
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.xeroReports.aged(organizationId, side === 'payable' ? 'payable' : 'receivable', {
      asOf,
      periods: periods ? parseInt(periods, 10) : undefined,
      periodDays: periodDays ? parseInt(periodDays, 10) : undefined,
      ageingBy,
      level,
    });
  }

  @Get('open-credits')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Open (unapplied) credit notes per contact — { contactId: creditLeft } — for the AR/AP balance lists' })
  openCredits(@Req() req: RequestWithOrganization, @Query('side') side: Side = 'receivable') {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.xeroReports.openCreditsByContact(organizationId, side === 'payable' ? 'payable' : 'receivable');
  }

  @Get('invoice-report')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Receivable/payable invoice listing for a period, grouped by contact' })
  invoiceReport(
    @Req() req: RequestWithOrganization,
    @Query('side') side: Side = 'receivable',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('dateBasis') dateBasis?: 'documentDate' | 'dueDate',
    @Query('status') status?: 'all' | 'outstanding' | 'paid',
    @Query('level') level?: 'summary' | 'detail',
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.xeroReports.invoiceReport(organizationId, side === 'payable' ? 'payable' : 'receivable', {
      from,
      to,
      dateBasis,
      status,
      level,
    });
  }

  @Get('contact-transactions')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Opening / movement / closing balance for one contact over a period' })
  contactTransactions(
    @Req() req: RequestWithOrganization,
    @Query('contactType') contactType: 'customer' | 'supplier' = 'customer',
    @Query('contactId') contactId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    if (!contactId) throw new Error('contactId is required');
    return this.xeroReports.contactTransactions(organizationId, { contactType, contactId, from, to });
  }

  @Get('income-expense-by-contact')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'Income and expenses per contact across comparison month columns' })
  incomeExpenseByContact(
    @Req() req: RequestWithOrganization,
    @Query('to') to?: string,
    @Query('compareMonths') compareMonths?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.xeroReports.incomeExpenseByContact(organizationId, {
      to,
      compareMonths: compareMonths ? parseInt(compareMonths, 10) : undefined,
    });
  }

  @Get('gst-report')
  @Permissions('statements:read')
  @ApiOperation({ summary: 'GST report — per-document details by tax code (Category) + F5 summary boxes' })
  gstReport(
    @Req() req: RequestWithOrganization,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('taxCode') taxCode?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.xeroReports.gstReport(organizationId, { from, to, taxCode });
  }
}
