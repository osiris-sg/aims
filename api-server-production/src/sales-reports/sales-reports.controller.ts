import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { SalesReportsService } from './sales-reports.service';

@ApiTags('Sales Reports')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('sales-reports')
export class SalesReportsController {
  constructor(private readonly service: SalesReportsService) {}

  // Sales Summary / Detailed analysis by customer | salesman | product | category.
  @Get('summary')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Sales summary grouped by customer / salesman / product / category' })
  summary(
    @Req() req: any,
    @Query('dimension') dimension: 'customer' | 'salesman' | 'product' | 'category' = 'customer',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('codeFrom') codeFrom?: string,
    @Query('codeTo') codeTo?: string,
    @Query('sort') sort?: 'asc' | 'desc',
    @Query('costUpliftPct') costUpliftPct?: string,
  ) {
    const organizationId = req.userOrganization?.id;
    return this.service.summary(organizationId, {
      dimension: ['customer', 'salesman', 'product', 'category'].includes(dimension) ? dimension : 'customer',
      from, to, codeFrom, codeTo,
      sort: sort === 'desc' ? 'desc' : 'asc',
      costUpliftPct: costUpliftPct ? Number(costUpliftPct) : 0,
    });
  }

  @Get('detailed')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Detailed sales analysis grouped by customer / salesman / product / category' })
  detailed(
    @Req() req: any,
    @Query('dimension') dimension: 'customer' | 'salesman' | 'product' | 'category' = 'customer',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('codeFrom') codeFrom?: string,
    @Query('codeTo') codeTo?: string,
  ) {
    return this.service.detailed(req.userOrganization?.id, {
      dimension: ['customer', 'salesman', 'product', 'category'].includes(dimension) ? dimension : 'customer',
      from, to, codeFrom, codeTo,
    });
  }

  @Get('listing')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Quotation / Delivery Order / Invoice / Outstanding listing' })
  listing(
    @Req() req: any,
    @Query('type') type: 'quotation' | 'do' | 'invoice' | 'outstanding' = 'invoice',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listing(req.userOrganization?.id, {
      type: ['quotation', 'do', 'invoice', 'outstanding'].includes(type) ? type : 'invoice',
      from, to,
    });
  }

  @Get('last-sold')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Each item\'s most recent sale' })
  lastSold(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.lastSold(req.userOrganization?.id, { from, to });
  }

  @Get('slow-moving')
  @Permissions('documents:read')
  @ApiOperation({ summary: 'Items ranked by how little they sold in a window' })
  slowMoving(@Req() req: any, @Query('asOf') asOf?: string, @Query('months') months?: string) {
    return this.service.slowMoving(req.userOrganization?.id, { asOf, months: months ? Number(months) : 6 });
  }
}
