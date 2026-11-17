import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { SalesReportService } from './sales-report.service';

/**
 * WCT group (2026-11-18): Settings > Quotation categories (enableQuotationCategory)
 * and Reports > Sales report (enableSalesReport). Every other org: 400 (not enabled).
 */
@Controller()
@UseGuards(ClerkAuthGuard)
export class SalesReportController {
  constructor(private readonly service: SalesReportService) {}

  @Get('quotation-categories')
  @Permissions('documents:read')
  categories(@UserOrganization() org: { id: string }) {
    return this.service.categories(org.id);
  }

  @Put('quotation-categories')
  @Permissions('organizations:update')
  saveCategories(@UserOrganization() org: { id: string }, @Body() body: any) {
    return this.service.saveCategories(org.id, body || {});
  }

  /** ?salesperson=<key from the response's salespeople, blank = all>&from=yyyy-mm-dd&to=yyyy-mm-dd. Sales-only users always get their own. */
  @Get('sales-report')
  @Permissions('documents:read')
  report(@UserOrganization() org: { id: string }, @Req() req: any, @Query() query: { salesperson?: string; from?: string; to?: string }) {
    return this.service.report(org.id, { userId: req.user?.id, isOsirisAdmin: req.isOsirisAdmin === true }, query || {});
  }
}
