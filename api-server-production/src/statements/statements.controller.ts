import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { StatementsService } from './statements.service';
import { XeroReportsService, Side } from './xero-reports.service';
import { GenerateSOADto } from './dto/generate-soa.dto';
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
  ) {}

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
