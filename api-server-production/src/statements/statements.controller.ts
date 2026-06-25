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
  constructor(private readonly statementsService: StatementsService) {}

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
}
